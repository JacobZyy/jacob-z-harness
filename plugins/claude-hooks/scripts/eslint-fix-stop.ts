/**
 * Claude Code Stop hook: ESLint 自动修复。
 *
 * 用项目级 ESLint 对本会话改动的文件执行 --fix。
 * 纯静默运行：无论修复了什么、有没有 ESLint，都不输出任何内容到上下文。
 * 目的：利用 ESLint 的自动格式化/修复能力，零 token 开销。
 *
 * 触发条件：项目根目录存在 eslint 配置文件（.eslintrc.* 或 eslint.config.*）。
 */

/// <reference types="bun-types" />

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHookLogger } from './logger.ts';

const log = createHookLogger('Stop', 'eslint-fix-stop.ts');

// ── 类型 ────────────────────────────────────────────────────────────────────
interface TranscriptAssistantContent {
  type: string;
  name?: string;
  input?: { file_path?: string };
}

interface TranscriptLine {
  type?: string;
  message?: {
    content?: TranscriptAssistantContent[];
  };
}

// ── 常量 ────────────────────────────────────────────────────────────────────

const TS_JS_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte)$/;

/** ESLint 配置文件名模式（按常见优先级排列） */
const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.mjs',
  '.eslintrc.ts',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  '.eslintrc',
];

// ── 主流程 ──────────────────────────────────────────────────────────────────
function main(): void {
  log.info('hook triggered');

  // 1. 读取 stdin
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    silentExit();
  }
  if (!raw.trim()) silentExit();

  let input: { transcript_path?: string } = {};
  try {
    input = JSON.parse(raw);
  } catch {
    silentExit();
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) silentExit();

  // 2. 从 transcript 提取编辑过的文件
  const allFiles = extractEditedFiles(transcriptPath);
  log.info(`extracted ${allFiles.length} edited files from transcript: ${allFiles.join(', ')}`);
  if (allFiles.length === 0) {
    log.done('no edited files, exiting');
    silentExit();
  }

  // 3. 检测项目是否有 ESLint 配置
  const projectRoot = detectProjectRoot(allFiles[0]);
  if (!projectRoot || !hasEslintConfig(projectRoot)) {
    log.done(`no eslint config found in ${projectRoot ?? 'unknown project'}, skipping`);
    silentExit();
  }
  log.info(`project root: ${projectRoot}`);

  // 4. 检测 ESLint 可执行文件
  const eslintBin = findEslintBin(projectRoot);
  if (!eslintBin) {
    log.done('eslint binary not found, skipping');
    silentExit();
  }

  // 5. 运行 eslint --fix（静默，不关心结果）
  log.info(`running ${eslintBin} --fix on ${allFiles.length} files`);

  const result = spawnSync(eslintBin, ['--fix', ...allFiles], {
    encoding: 'utf8',
    cwd: projectRoot,
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    log.done(`eslint spawn error: ${result.error.message}`, 'error');
    silentExit();
  }

  const exitCode = result.status ?? -1;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  // ESLint exit code: 0=无问题, 1=有lint问题(但fix可能已修复), 2=致命错误
  if (exitCode === 2) {
    log.done(`eslint fatal error (exit=2)`, 'error', stderr.slice(0, 300));
  } else {
    const output = `${stdout}${stderr}`.trim();
    const fixedLines = output ? output.split('\n').length : 0;
    log.done(`eslint --fix completed (exit=${exitCode}, output=${fixedLines} lines)`);
  }

  // 永远静默退出 — 不向上下文输出任何内容
  silentExit();
}

// ── 项目根目录检测 ──────────────────────────────────────────────────────────

/**
 * 从文件路径向上查找项目根目录（包含 package.json 的最近目录）。
 */
function detectProjectRoot(filePath: string): string | null {
  let dir = filePath;
  // 最多向上查找 20 层
  for (let i = 0; i < 20; i++) {
    const parent = join(dir, '..');
    if (parent === dir) break; // 已到根目录
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = parent;
  }
  return null;
}

/**
 * 检查项目根目录是否存在 ESLint 配置文件。
 */
function hasEslintConfig(projectRoot: string): boolean {
  return ESLINT_CONFIG_FILES.some((f) => existsSync(join(projectRoot, f)));
}

/**
 * 查找 ESLint 可执行文件（优先项目级，然后全局）。
 */
function findEslintBin(projectRoot: string): string | null {
  // 项目级 node_modules/.bin/eslint
  const localBin = join(projectRoot, 'node_modules', '.bin', 'eslint');
  if (existsSync(localBin)) return localBin;

  // npx eslint（依赖 PATH 中有 npx）
  const npxResult = spawnSync('which', ['npx'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (npxResult.status === 0 && npxResult.stdout?.trim()) {
    return 'npx';
  }

  // 全局 eslint
  const globalResult = spawnSync('which', ['eslint'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (globalResult.status === 0 && globalResult.stdout?.trim()) {
    return 'eslint';
  }

  return null;
}

// ── transcript 解析 ─────────────────────────────────────────────────────────
function extractEditedFiles(transcriptPath: string): string[] {
  let raw = '';
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const fileSet = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (parsed.type !== 'assistant') continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!isWriteTool(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp !== 'string') continue;
      if (!TS_JS_EXTENSIONS.test(fp)) continue;
      if (!isExistingFile(fp)) continue;
      fileSet.add(fp);
    }
  }
  return [...fileSet].sort();
}

function isWriteTool(name?: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit';
}

function isExistingFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── 输出 ────────────────────────────────────────────────────────────────────
function silentExit(): never {
  process.exit(0);
}

main();
