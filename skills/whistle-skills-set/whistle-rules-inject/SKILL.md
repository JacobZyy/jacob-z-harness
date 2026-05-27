---
name: whistle-rules-inject
description: >
  将 Whistle 规则注入到本地 Whistle 配置的 defalutRules 中。
  支持所有规则类型（file://, resBody://, reqHeaders://, proxy://, host:// 等）。
  自动检测 whistle-node 和 whistle-client 实例，自动去重，通过 HTTP API 即时生效无需重启。
  当用户在 whistle-proxy 或 whistle-rewrite 对话中生成规则后需要注入本地时触发。
  触发场景："注入到 whistle"、"添加到 whistle 配置"、"写入 whistle 规则"、
  "更新 whistle 规则"、"加到本地 whistle"、"注入规则"。
---

# Whistle Rules Inject

将 AI 生成的 Whistle 规则注入到本地 Whistle 配置的 `defalutRules` 中，**即时生效无需重启**。

## 注入方式

| 方式 | 脚本 | 适用场景 |
|------|------|----------|
| **HTTP API（推荐）** | `inject_via_api.py` | Whistle 正在运行，立即生效 |
| 文件直写（回退） | `inject_rule.py` | Whistle 未运行，需后续重启生效 |

## 工作流程（API 注入）

### 1. 确认规则内容

- 从上下文中提取要注入的规则（通常由 `whistle-proxy` 或 `whistle-rewrite` skill 生成）
- 规则格式：`pattern operation [filters...]`
- 支持所有操作类型：`file://`, `resBody://`, `reqHeaders://`, `proxy://`, `host://`, `resHeaders://`, `statusCode://` 等

### 2. 检测并选择目标实例

脚本自动检测 `~/.WhistleAppData/` 下的两种实例：
- **whistle-client**（桌面版）：`~/.WhistleAppData/.whistle_client/.whistle`
- **whistle-node**（CLI 版）：`~/.WhistleAppData/.whistle`

- 如果只检测到 **1 个** 实例 → 自动使用
- 如果检测到 **2 个** 实例 → 使用 `--instance` 指定，或提示用户选择
- 如果 **0 个** 实例 → 报错

### 3. 预览确认

- 向用户展示将要注入的规则内容
- 展示目标实例名称和端口
- **必须等用户确认后**才执行注入

### 4. 注入规则（通过 HTTP API）

```bash
python3 scripts/inject_via_api.py \
  --instance whistle-client \
  --rule "完整的规则行"
```

脚本行为：
- 自动从运行中进程获取认证凭证（authKey 或 Basic Auth）
- 通过 `GET /rules?name=Default` 获取现有规则
- 将新规则插入到 `defalutRules` **最顶部**（优先级最高）
- 自动去重：相同 pattern + 相同操作协议的规则，移除旧规则
- 通过 `POST /cgi-bin/rules/add` 写入并即时激活
- **无需重启 Whistle**

**预览模式（不实际注入）：**
```bash
python3 scripts/inject_via_api.py \
  --instance whistle-client \
  --rule "完整的规则行" \
  --dry-run
```

### 5. 验证结果

- `GET /rules?name=Default` 检查 Default 规则顶部是否有新规则
- 不需要其他操作，规则已即时生效

## 工作流程（文件直写回退）

当 whistle 未运行时，使用文件直写方式。**写入后需要启动/重启 whistle 才能生效。**

```bash
python3 scripts/inject_rule.py \
  --whistle-home "/path/to/.whistle" \
  --rule "完整的规则行"
```

## 去重逻辑

去重基于 **pattern + 操作协议** 的组合：
- 相同 `pattern` + 相同 `protocol://` → 视为重复，替换旧规则
- 例如：`www.example.com/api file://(old)` 和 `www.example.com/api file://(new)` → 新规则替换旧规则
- 不同 pattern 或不同操作协议 → 不冲突，共存

## 命令速查

```bash
# === API 注入（推荐，即时生效） ===

# 自动检测实例
python3 scripts/inject_via_api.py --rule 'www.example.com/api file://({"status":"ok"})'

# 指定实例
python3 scripts/inject_via_api.py \
  --instance whistle-client \
  --rule 'www.example.com/api file://({"status":"ok"})'

# 指定端口（跳过实例检测）
python3 scripts/inject_via_api.py \
  --port 8899 \
  --rule 'www.example.com/api file://({"status":"ok"})'

# 预览模式
python3 scripts/inject_via_api.py \
  --port 8899 \
  --rule 'www.example.com/api file://({"status":"ok"})' \
  --dry-run

# JSON 输出（便于 AI 解析）
python3 scripts/inject_via_api.py \
  --port 8899 \
  --rule 'www.example.com/api file://({"status":"ok"})' \
  --json

# === 文件直写（回退，需重启生效） ===

# 检测可用实例
python3 scripts/list_whistle_instances.py

# 预览注入
python3 scripts/inject_rule.py \
  --whistle-home ~/.WhistleAppData/.whistle_client/.whistle \
  --rule 'www.example.com/api file://({"status":"ok"})' \
  --dry-run

# 执行注入
python3 scripts/inject_rule.py \
  --whistle-home ~/.WhistleAppData/.whistle_client/.whistle \
  --rule 'www.example.com/api file://({"status":"ok"})'
```

## 实例路径速查

| 实例 | 数据目录 | 端口来源 |
|------|----------|----------|
| whistle-client | `~/.WhistleAppData/.whistle_client/.whistle` | `proxy_settings/properties` → `port` |
| whistle-node | `~/.WhistleAppData/.whistle` | 进程参数或默认 8899 |

## 注意事项

- 规则始终注入到 `defalutRules` 字段中（不是单独的规则文件）
- 新规则始终放在 `defalutRules` 最顶部
- API 注入方式需要 Whistle 正在运行
- 文件直写方式需要 Python 3，API 注入还需要 Whistle 进程可访问
- whistle-client 每次启动会随机生成认证凭证（authKey/密码），脚本自动从进程提取

## 与 whistle-* skill 体系的关系

| 步骤 | 使用的 Skill |
|------|-------------|
| 编写规则 | `whistle-proxy` 或 `whistle-rewrite` |
| 了解规则语法 | `whistle-rules` |
| 注入到本地 | `whistle-rules-inject`（本 skill） |
| 排查问题 | `whistle-advanced` |
