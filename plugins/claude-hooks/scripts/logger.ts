/**
 * 统一 hook 日志模块 — 所有 claude-hooks 共用。
 *
 * 日志路径: ~/.claude/data/hooks.log  (JSONL 格式)
 * 每行一条: { ts, hook, script, level, msg, duration_ms?, detail? }
 *
 * 特性:
 *   - appendFileSync 零依赖写入
 *   - 超过 10MB 自动截断保留最近部分
 *   - createHookLogger() 返回带 duration 追踪的 logger 实例
 */

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── 常量 ──────────────────────────────────────────────────────────────────
const LOG_DIR = join(homedir(), '.claude', 'data');
const LOG_PATH = join(LOG_DIR, 'hooks.log');
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  ts: string;
  hook: string;
  script: string;
  level: LogLevel;
  msg: string;
  duration_ms?: number;
  detail?: string;
}

// ── 自动轮转 ──────────────────────────────────────────────────────────────
function rotateIfNeeded(): void {
  try {
    if (!existsSync(LOG_PATH)) return;
    const size = statSync(LOG_PATH).size;
    if (size < MAX_BYTES) return;

    // 保留最近 2MB 的内容
    const keepBytes = 2 * 1024 * 1024;
    const content = readFileSync(LOG_PATH, 'utf8');
    // 从尾部往前找第一个换行符，保证截断后仍是完整行
    const cutFrom = content.length - keepBytes;
    const firstNl = content.indexOf('\n', cutFrom);
    if (firstNl < 0) return;
    const trimmed = content.slice(firstNl + 1);
    writeFileSync(LOG_PATH, trimmed, 'utf8');
  } catch {
    // 轮转失败不影响主流程
  }
}

// ── 核心写入 ──────────────────────────────────────────────────────────────
function writeLog(entry: LogEntry): void {
  try {
    rotateIfNeeded();
    appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // 写入失败不影响 hook 主流程
  }
}

// ── 对外 API ──────────────────────────────────────────────────────────────
export interface HookLogger {
  info: (msg: string, detail?: string) => void;
  warn: (msg: string, detail?: string) => void;
  error: (msg: string, detail?: string) => void;
  /** 记录 hook 结束并自动附带 duration */
  done: (msg: string, level?: LogLevel, detail?: string) => void;
}

/**
 * 创建一个绑定 hook 名称和脚本名称的 logger 实例。
 * 自动记录 start 时间，done() 时计算 duration_ms。
 *
 * @example
 * ```ts
 * const log = createHookLogger('PostToolUse', 'token-stats-tool.ts');
 * log.info('tool call recorded');
 * log.done('completed'); // 自动附带 duration
 * ```
 */
export function createHookLogger(hook: string, script: string): HookLogger {
  const startMs = Date.now();

  function makeEntry(level: LogLevel, msg: string, detail?: string): LogEntry {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      hook,
      script,
      level,
      msg,
    };
    if (detail) entry.detail = detail;
    return entry;
  }

  return {
    info(msg: string, detail?: string) {
      writeLog(makeEntry('info', msg, detail));
    },
    warn(msg: string, detail?: string) {
      writeLog(makeEntry('warn', msg, detail));
    },
    error(msg: string, detail?: string) {
      writeLog(makeEntry('error', msg, detail));
    },
    done(msg: string, level: LogLevel = 'info', detail?: string) {
      const entry = makeEntry(level, msg, detail);
      entry.duration_ms = Date.now() - startMs;
      writeLog(entry);
    },
  };
}

/** 日志文件路径（方便外部脚本引用） */
export { LOG_PATH };
