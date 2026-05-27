#!/usr/bin/env python3
"""通过 Whistle HTTP API 注入规则到 defalutRules，即时生效无需重启。

支持 whistle-client (桌面版) 和 whistle-node (CLI 版)。
自动发现端口和认证凭证，通过 POST /cgi-bin/rules/add 注入。
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

WHISTLE_BASE = Path.home() / '.WhistleAppData'

# 实例配置：名称 → (数据目录, 端口配置来源)
INSTANCE_CONFIGS = {
    'whistle-client': {
        'data_dir': WHISTLE_BASE / '.whistle_client' / '.whistle',
        'port_file': WHISTLE_BASE / '.whistle_client' / 'proxy_settings' / 'properties',
        'port_field': 'port',
    },
    'whistle-node': {
        'data_dir': WHISTLE_BASE / '.whistle',
        'port_file': None,  # 无端口配置文件，使用默认或进程检测
        'port_field': None,
    },
}


# ── 端口发现 ──────────────────────────────────────────────────


def get_client_port() -> int | None:
    """从 whistle-client 的 proxy_settings/properties 中读取端口。"""
    port_file = INSTANCE_CONFIGS['whistle-client']['port_file']
    if not port_file.exists():
        return None
    try:
        data = json.loads(port_file.read_text())
        port = data.get('port')
        if port and str(port).isdigit():
            return int(port)
    except (json.JSONDecodeError, OSError, ValueError):
        pass
    return None


def get_node_port() -> int | None:
    """从 whistle-node 进程参数中提取端口，回退默认 8899。"""
    config = _get_process_config()
    if config:
        port = config.get('port')
        if port:
            return int(port)
    return 8899  # 默认端口


# ── 认证凭证提取 ──────────────────────────────────────────────


def _get_process_config() -> dict | None:
    """从运行中的 whistle pfork 进程提取运行时配置。

    解析 pfork 进程命令行中的 URL-encoded JSON 配置块。
    """
    try:
        result = subprocess.run(
            ['ps', '-eo', 'pid,args', '-ww'],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return None

    for line in result.stdout.splitlines():
        if 'pfork/lib/main' not in line:
            continue
        idx = line.find('pfork/lib/main')
        if idx <= 0:
            continue
        encoded = line[idx + len('pfork/lib/main'):].strip()
        decoded = urllib.parse.unquote(encoded)
        # 用正则逐字段提取，避免完整 JSON 解析（命令行可能被截断）
        config = {}
        for field in ['authKey', 'username', 'password', 'baseDir']:
            m = re.search(rf'"{field}":"([^"]*)"', decoded)
            if m:
                config[field] = m.group(1)
        for field in ['port', 'uiport']:
            m = re.search(rf'"{field}":(\d+)', decoded)
            if m:
                config[field] = int(m.group(1))
        if config:
            return config
    return None


def get_auth_headers() -> dict[str, str] | None:
    """构造认证头。优先 authKey 头，其次 Basic Auth。"""
    config = _get_process_config()
    if not config:
        return None

    auth_key = config.get('authKey')
    if auth_key:
        return {'x-whistle-auth-key': auth_key}

    username = config.get('username')
    password = config.get('password')
    if username and password:
        import base64
        credentials = base64.b64encode(f'{username}:{password}'.encode()).decode()
        return {'Authorization': f'Basic {credentials}'}

    return None


# ── 规则去重 ──────────────────────────────────────────────────


def extract_pattern_and_op(rule_line: str) -> tuple[str, str] | None:
    """从规则行中提取 pattern 和第一个 operation。

    规则格式: pattern operation1 [operation2 ...] [filters...]
    """
    stripped = rule_line.strip()
    if not stripped or stripped.startswith('#'):
        return None

    # 去掉行内注释（空格后的 #）
    parts = stripped.split()
    cleaned = []
    for p in parts:
        if p.startswith('#'):
            break
        cleaned.append(p)
    stripped = ' '.join(cleaned)

    parts = stripped.split()
    if len(parts) < 2:
        return None

    pattern = parts[0]
    for i, part in enumerate(parts[1:], start=1):
        if '://' in part:
            return (pattern, part)
        if i == 1:
            return (pattern, part)
    return None


def build_dedup_key(rule_line: str) -> str | None:
    """构建去重键: pattern|protocol。"""
    parsed = extract_pattern_and_op(rule_line)
    if parsed is None:
        return None
    pattern, operation = parsed
    protocol = operation.split('://')[0] if '://' in operation else 'host'
    return f'{pattern}|{protocol}'


def merge_rules(existing: str, new_rule: str) -> tuple[str, bool]:
    """将新规则合并到现有规则顶部，按 pattern+protocol 去重。

    Returns:
        (merged_rules, was_removed)
    """
    existing_lines = existing.splitlines()
    new_key = build_dedup_key(new_rule)

    kept_lines = []
    removed = False
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            kept_lines.append(line)
            continue
        key = build_dedup_key(stripped)
        if new_key and key == new_key:
            removed = True
            continue
        kept_lines.append(line)

    result = new_rule + '\n' + '\n'.join(kept_lines)
    return result.rstrip('\n') + '\n', removed


# ── HTTP API ──────────────────────────────────────────────────


def api_request(
    port: int,
    method: str,
    path: str,
    headers: dict[str, str] | None = None,
    body: dict | None = None,
) -> tuple[int, dict | str]:
    """向 Whistle HTTP API 发送请求。

    Returns:
        (http_status_code, response_body_dict_or_text)
    """
    url = f'http://localhost:{port}{path}'
    req_headers = headers.copy() if headers else {}
    req_headers.setdefault('Content-Type', 'application/json')

    data = None
    if body is not None:
        data = json.dumps(body).encode('utf-8')

    try:
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            raw = resp.read().decode('utf-8')
            try:
                return status, json.loads(raw)
            except json.JSONDecodeError:
                return status, raw
    except urllib.error.HTTPError as e:
        return e.code, f'HTTP {e.code}: {e.reason}'
    except urllib.error.URLError as e:
        return 0, f'连接失败: {e.reason}'
    except Exception as e:
        return 0, f'请求异常: {e}'


def get_rules(port: int, headers: dict[str, str], name: str = 'Default') -> str:
    """获取指定规则文件的内容。"""
    status, body = api_request(port, 'GET', f'/rules?name={name}', headers=headers)
    if status != 200:
        return ''
    if isinstance(body, str):
        return body
    return ''


def inject_rules(port: int, headers: dict[str, str], rules_text: str, name: str = 'Default') -> dict:
    """通过 POST /cgi-bin/rules/add 注入规则到指定文件，不存在则自动创建。"""
    status, body = api_request(
        port,
        'POST',
        '/cgi-bin/rules/add',
        headers=headers,
        body={
            'name': name,
            'value': rules_text,
            'selected': True,
        },
    )
    if status == 200 and isinstance(body, dict):
        return body
    return {'ec': -1, 'em': f'HTTP {status}: {body}'}


# ── 实例检测 ──────────────────────────────────────────────────


def detect_instances() -> list[dict]:
    """检测本地可用的 Whistle 实例。返回 [{name, data_dir, port}]。"""
    instances = []
    for name, cfg in INSTANCE_CONFIGS.items():
        data_dir = cfg['data_dir']
        props = data_dir / 'rules' / 'properties'
        if not props.exists():
            continue

        # 确定端口
        if name == 'whistle-client':
            port = get_client_port()
        else:
            port = get_node_port()

        # 确定数据是否有效
        try:
            data = json.loads(props.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        instances.append({
            'name': name,
            'data_dir': str(data_dir),
            'port': port,
            'has_default_rules': bool(data.get('defalutRules', '')),
        })
    return instances


# ── 入口 ──────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(
        description='通过 Whistle HTTP API 注入规则，即时生效无需重启。',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
示例:
  # 指定端口注入（跳过实例检测）
  %(prog)s --port 8899 --rule 'www.example.com/api file://({"status":"ok"})'

  # 自动检测实例（两个实例都存在时需要选择）
  %(prog)s --rule 'www.example.com/api file://({"status":"ok"})'

  # 指定实例名称
  %(prog)s --instance whistle-client --rule 'www.example.com/api file://({"status":"ok"})'

  # 注入到指定文件（非 Default）
  %(prog)s --name my-rules --rule 'www.example.com/api file://({"status":"ok"})'

  # 预览模式
  %(prog)s --port 8899 --rule 'www.example.com/api file://({"status":"ok"})' --dry-run
        ''',
    )
    parser.add_argument(
        '--name',
        default='Default',
        help='规则文件名称，默认为 Default。文件不存在时会自动创建',
    )
    parser.add_argument(
        '--rule',
        required=True,
        help='要注入的完整规则行',
    )
    parser.add_argument(
        '--port',
        type=int,
        default=None,
        help='Whistle Web UI 端口（自动检测时可不传）',
    )
    parser.add_argument(
        '--instance',
        choices=['whistle-client', 'whistle-node'],
        default=None,
        help='目标实例名称（自动选择时可不传）',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='仅预览，不实际注入',
    )
    parser.add_argument(
        '--json',
        action='store_true',
        help='以 JSON 格式输出结果',
    )
    args = parser.parse_args()

    new_rule = args.rule.strip()
    if not new_rule:
        print('错误: --rule 不能为空', file=sys.stderr)
        sys.exit(1)

    # ── 确定目标端口 ──────────────────────────────────────
    port = args.port

    if port is None:
        instances = detect_instances()
        if not instances:
            print('错误: 未检测到任何 Whistle 实例', file=sys.stderr)
            sys.exit(1)

        if args.instance:
            # 用户指定了实例名
            matched = [i for i in instances if i['name'] == args.instance]
            if not matched:
                names = ', '.join(i['name'] for i in instances)
                print(
                    f'错误: 实例 "{args.instance}" 不可用，可用实例: {names}',
                    file=sys.stderr,
                )
                sys.exit(1)
            target = matched[0]
        elif len(instances) == 1:
            target = instances[0]
        else:
            # 多个实例，需要选择
            print('检测到多个 Whistle 实例:', file=sys.stderr)
            for idx, inst in enumerate(instances):
                port_str = f':{inst["port"]}' if inst['port'] else ''
                print(
                    f'  [{idx + 1}] {inst["name"]} (端口{port_str})',
                    file=sys.stderr,
                )
            print('请使用 --instance 指定目标实例', file=sys.stderr)
            for inst in instances:
                print(
                    f'  例如: --instance {inst["name"]}',
                    file=sys.stderr,
                )
            sys.exit(1)

        port = target['port']
        if not port:
            print(
                f'错误: 无法确定实例 "{target["name"]}" 的端口',
                file=sys.stderr,
            )
            sys.exit(1)

        if not args.json:
            print(f'目标: {target["name"]} (端口 {port})', file=sys.stderr)

    # ── 获取认证凭证 ──────────────────────────────────────
    headers = get_auth_headers()
    if not headers:
        print(
            '错误: 无法获取认证凭证，请确保 Whistle 正在运行',
            file=sys.stderr,
        )
        sys.exit(1)

    if not args.json:
        auth_method = 'authKey' if 'x-whistle-auth-key' in headers else 'Basic Auth'
        print(f'认证方式: {auth_method}', file=sys.stderr)

    # ── 获取现有规则并合并 ────────────────────────────────
    rules_name = args.name
    existing = get_rules(port, headers, rules_name)
    merged, was_removed = merge_rules(existing, new_rule)


    if merged.strip() == existing.strip():
        result = {
            'status': 'unchanged',
            'message': '规则已存在且内容相同，无需更新',
            'rule': new_rule,
            'name': rules_name,
            'port': port,
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print('无需更新 — 规则已存在且内容相同')
            print(f'规则: {new_rule}')
        return

    if args.dry_run:
        result = {
            'status': 'dry_run',
            'message': '预览模式 — 以下是将注入的规则',
            'rule': new_rule,
            'name': rules_name,
            'removed_old': was_removed,
            'port': port,
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print('=== 预览 ===')
            if was_removed:
                print('(将替换已有同 endpoint 规则)')
            print(f'注入规则: {new_rule}')
            print(f'目标端口: {port}')
        return

    # ── 执行注入 ──────────────────────────────────────────
    api_result = inject_rules(port, headers, merged, rules_name)

    if api_result.get('ec') == 0:
        result = {
            'status': 'injected',
            'message': '规则已注入，即时生效',
            'rule': new_rule,
            'name': rules_name,
            'removed_old': was_removed,
            'port': port,
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            if was_removed:
                print('(已替换旧规则)')
            print(f'✅ 已注入: {new_rule}')
            print(f'目标: localhost:{port} (rules/add → {rules_name})')
    else:
        err_msg = api_result.get('em', str(api_result))
        result = {
            'status': 'error',
            'message': f'注入失败: {err_msg}',
            'rule': new_rule,
            'name': rules_name,
            'port': port,
        }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            print(f'❌ 注入失败: {err_msg}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
