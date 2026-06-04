/**
 * Claude Code Stop hook: 函数嵌套复杂度检测。
 *
 * 移植自 eslint_plugin_zz_nested_complexity 1.x 分支。
 * 使用 oxc-parser 解析 AST，计算函数嵌套复杂度，超标则 block。
 *
 * 开关机制: ~/.claude/data/complexity-config.json
 *   { "enabledProjects": ["/absolute/path/to/project1", ...] }
 * 仅当 CWD 在 enabledProjects 列表中时才执行检测。
 *
 * 输出协议（同 lint-fix-stop.ts）：
 *   stdout 写一行 JSON：{ systemMessage, decision?, reason? }
 *     - systemMessage   UI 渲染成 "L Stop says: ..."
 *     - decision=block  阻断 Stop
 *     - reason          阻断时塞回 Claude 上下文的指令
 *   进程 exit 0。
 */

/// <reference types="bun-types" />

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { createHookLogger } from './logger.ts';

const log = createHookLogger('Stop', 'complexity-stop.ts');

// ── 类型 ────────────────────────────────────────────────────────────────────
interface StopHookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
}

interface HookResponse {
  systemMessage: string;
  decision?: 'block';
  reason?: string;
}

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

interface ComplexityConfig {
  enabledProjects?: string[];
}

interface ComplexityResult {
  complexity: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  functionName: string;
  filePath: string;
}

/** oxc-parser 的 AST 节点（ESTree 兼容，但用 start/end 而非 loc） */
interface ASTNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}

// ── 常量 ────────────────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), '.claude', 'data', 'complexity-config.json');

const JS_TS_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** 增加复杂度的 AST 节点类型 */
const COMPLEXITY_NODE_TYPES = new Set([
  'IfStatement',
  'CatchClause',
  'ConditionalExpression',
  'LogicalExpression',
  'ForStatement',
  'ForInStatement',
  'ForOfStatement',
  'WhileStatement',
  'DoWhileStatement',
]);

const LOGICAL_ASSIGNMENT_OPS = new Set(['&&=', '||=', '??=']);

/** 按函数总行数分级的复杂度阈值（移植自原插件） */
const THRESHOLD_MAP: Array<{ lineScope: [number, number]; thresholdValue: number }> = [
  { lineScope: [0, 50], thresholdValue: 25 },
  { lineScope: [50, 100], thresholdValue: 25 },
  { lineScope: [100, 200], thresholdValue: 35 },
  { lineScope: [200, 300], thresholdValue: 54 },
  { lineScope: [300, 400], thresholdValue: 65 },
  { lineScope: [400, 500], thresholdValue: 83 },
  { lineScope: [500, 600], thresholdValue: 98 },
  { lineScope: [600, 700], thresholdValue: 119 },
  { lineScope: [700, 800], thresholdValue: 140 },
  { lineScope: [800, 900], thresholdValue: 165 },
  { lineScope: [900, 1000], thresholdValue: 165 },
  { lineScope: [1000, 99999], thresholdValue: 267 },
];

// ── 输出辅助 ────────────────────────────────────────────────────────────────
function emit(resp: HookResponse): never {
  process.stdout.write(`${JSON.stringify(resp)}\n`);
  process.exit(0);
}

function silentExit(): never {
  process.exit(0);
}

// ── 行号映射（oxc-parser 用字节偏移，需转换为行号） ──────────────────────────

/**
 * 从源码构建字节偏移 → 行号的查找表。
 * lineOffsets[i] = 第 i 行（1-based）的起始字节偏移。
 */
function buildLineOffsets(source: string): number[] {
  const offsets = [0]; // 占位，让 index 从 1 开始
  let pos = 0;
  for (const ch of source) {
    if (ch === '\n') {
      offsets.push(pos + 1);
    }
    pos++;
  }
  // 确保最后一行也能查到
  if (offsets.length === 1 || source[source.length - 1] !== '\n') {
    offsets.push(pos + 1);
  }
  return offsets;
}

/** 二分查找偏移量对应的行号（1-based） */
function offsetToLine(lineOffsets: number[], byteOffset: number): number {
  let lo = 1;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= byteOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log.info('hook triggered');

  // 1. 读取 stdin
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    silentExit();
  }
  if (!raw.trim()) silentExit();

  let input: StopHookInput = {};
  try {
    input = JSON.parse(raw) as StopHookInput;
  } catch {
    silentExit();
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) silentExit();

  const stopHookActive = input.stop_hook_active === true;

  // 2. 检查开关 — CWD 是否在 enabledProjects 中
  const cwd = process.cwd();
  if (!isProjectEnabled(cwd)) {
    log.done(`project not enabled (cwd=${cwd}), skipping`);
    silentExit();
  }
  log.info(`project enabled (cwd=${cwd})`);

  // 3. 从 transcript 提取本会话编辑过的 JS/TS 文件
  const files = extractEditedFiles(transcriptPath);
  log.info(`extracted ${files.length} edited JS/TS files from transcript: ${files.join(', ')}`);
  if (files.length === 0) {
    log.done('no edited JS/TS files, exiting');
    silentExit();
  }

  // 4. 动态导入 oxc-parser
  let parseSync: (typeof import('oxc-parser'))['parseSync'];
  try {
    const oxc = await import('oxc-parser');
    parseSync = oxc.parseSync;
  } catch {
    log.warn('oxc-parser not available, skipping');
    emit({
      systemMessage: '⚠️ [complexity] oxc-parser 未安装，跳过嵌套复杂度检测',
    });
  }
  log.info('oxc-parser loaded');

  // 5. 逐文件解析 + 计算复杂度
  const allViolations: ComplexityResult[] = [];

  for (const filePath of files) {
    try {
      const source = readFileSync(filePath, 'utf8');
      const lang = detectLang(filePath);
      const result = parseSync!(filePath, source, { lang });

      if (result.errors.length > 0) {
        log.warn(`parse errors in ${filePath}: ${result.errors.length} errors`);
        continue;
      }

      const lineOffsets = buildLineOffsets(source);
      const violations = checkProgram(
        result.program as unknown as ASTNode,
        lineOffsets,
        filePath,
        cwd,
      );
      allViolations.push(...violations);
      if (violations.length > 0) {
        log.warn(`${relative(cwd, filePath)}: ${violations.length} violations — ${violations.map((v) => `${v.functionName}(complexity=${v.complexity},max=${getThreshold(v.totalLines)})`).join(', ')}`);
      }
    } catch (err) {
      log.warn(`failed to process ${filePath}: ${String(err)}`);
    }
  }

  if (allViolations.length === 0) {
    log.done(`passed (${files.length} files, 0 violations)`);
    emit({
      systemMessage: `✅ [complexity] 嵌套复杂度检查通过（${files.length} 个文件，0 违规）`,
    });
  }

  log.done(`${allViolations.length} violations across ${files.length} files`, 'warn');

  // 6. 格式化违规报告
  const lines = allViolations.map(
    (v) =>
      `  • ${relative(cwd, v.filePath)} → ${v.functionName}: complexity=${v.complexity}, max=${getThreshold(v.totalLines)}, lines=${v.totalLines} (L${v.startLine}-L${v.endLine})`,
  );

  const summary = `❌ [complexity] 检测到 ${allViolations.length} 个函数嵌套复杂度超标`;

  if (stopHookActive) {
    emit({
      systemMessage: `${summary}（已提示过本轮不再阻断，请尽快修复）\n\n${lines.join('\n')}`,
    });
  }

  const reason = [
    '嵌套复杂度检测结果：',
    '',
    ...lines,
    '',
    '处理建议：',
    '  1) 抽取复杂逻辑到独立函数，降低单函数复杂度',
    '  2) 使用早返回 (early return) 减少嵌套层级',
    '  3) 将长 switch/if-else 链替换为策略模式或查找表',
    '  4) 确认被调用函数的复杂度也被计入（跨函数追踪）',
  ].join('\n');

  emit({ systemMessage: summary, decision: 'block', reason });
}

// ── 开关检查 ────────────────────────────────────────────────────────────────
function isProjectEnabled(cwd: string): boolean {
  if (!existsSync(CONFIG_PATH)) return false;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8');
    const config = JSON.parse(raw) as ComplexityConfig;
    if (!Array.isArray(config.enabledProjects)) return false;
    return config.enabledProjects.some((p) => cwd.startsWith(p));
  } catch {
    return false;
  }
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
      if (!JS_TS_EXTENSIONS.test(fp)) continue;
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

function detectLang(filePath: string): string {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.jsx')) return 'jsx';
  if (
    filePath.endsWith('.ts') ||
    filePath.endsWith('.mts') ||
    filePath.endsWith('.cts')
  )
    return 'typescript';
  return 'javascript';
}

// ── 复杂度计算核心 ──────────────────────────────────────────────────────────

/**
 * 检查整个 AST Program，返回所有超标函数。
 */
function checkProgram(
  program: ASTNode,
  lineOffsets: number[],
  filePath: string,
  cwd: string,
): ComplexityResult[] {
  const violations: ComplexityResult[] = [];
  const processedFunctions = new Set<ASTNode>();

  // 遍历 Program，收集所有函数节点
  const allFunctions = collectFunctionNodes(program);

  for (const funcNode of allFunctions) {
    const startLine = offsetToLine(lineOffsets, funcNode.start);
    const endLine = offsetToLine(lineOffsets, funcNode.end);
    const functionName = getFunctionName(funcNode, program);

    // 每个顶层函数重置 processedFunctions（避免跨函数重复追踪污染）
    processedFunctions.clear();
    processedFunctions.add(funcNode);

    const { complexity, totalLines } = calculateComplexity(
      funcNode,
      program,
      processedFunctions,
      lineOffsets,
    );

    const threshold = getThreshold(totalLines);
    if (complexity > threshold) {
      violations.push({
        complexity,
        totalLines,
        startLine,
        endLine,
        functionName: functionName || '<anonymous>',
        filePath,
      });
    }
  }

  return violations;
}

/**
 * 递归收集 AST 中所有函数声明/表达式/箭头函数节点。
 */
function collectFunctionNodes(ast: unknown): ASTNode[] {
  const functions: ASTNode[] = [];
  const FUNCTION_TYPES = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
  ]);

  function traverse(node: unknown): void {
    if (!isASTNode(node)) return;
    if (FUNCTION_TYPES.has(node.type)) {
      functions.push(node);
    }
    for (const key of getVisitorKeys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) traverse(item);
      } else {
        traverse(child);
      }
    }
  }

  traverse(ast);
  return functions;
}

/**
 * 计算单个函数的嵌套复杂度（含同文件跨函数追踪）。
 * 移植自原插件 calculateComplexity + traverse。
 */
function calculateComplexity(
  funcNode: ASTNode,
  programAst: ASTNode,
  processedFunctions: Set<ASTNode>,
  lineOffsets: number[],
): { complexity: number; totalLines: number } {
  let complexity = 1;
  const startLine = offsetToLine(lineOffsets, funcNode.start);
  const endLine = offsetToLine(lineOffsets, funcNode.end);
  let totalLines = endLine - startLine + 1;

  function traverse(node: unknown): void {
    if (!isASTNode(node)) return;
    const n = node as ASTNode;
    const keys = getVisitorKeys(n);

    for (const key of keys) {
      const child = n[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (!isASTNode(item)) continue;
          complexity += countNodeComplexity(item);

          // 跨函数调用追踪
          const callName = extractCalleeName(item);
          if (callName) {
            const target = findFunctionDeclaration(programAst, callName);
            if (target && !processedFunctions.has(target)) {
              processedFunctions.add(target);
              const result = calculateComplexity(
                target,
                programAst,
                processedFunctions,
                lineOffsets,
              );
              complexity += result.complexity;
              totalLines += result.totalLines;
            }
          }

          traverse(item);
        }
      } else if (isASTNode(child)) {
        complexity += countNodeComplexity(child);

        const callName = extractCalleeName(child);
        if (callName) {
          const target = findFunctionDeclaration(programAst, callName);
          if (target && !processedFunctions.has(target)) {
            processedFunctions.add(target);
            const result = calculateComplexity(
              target,
              programAst,
              processedFunctions,
              lineOffsets,
            );
            complexity += result.complexity;
            totalLines += result.totalLines;
          }
        }

        traverse(child);
      }
    }
  }

  traverse(funcNode);
  return { complexity, totalLines };
}

/**
 * 判断一个 AST 节点贡献多少复杂度。
 */
function countNodeComplexity(node: ASTNode): number {
  const { type } = node;

  // if / catch / 三元 / 逻辑运算 / 循环 → +1
  if (COMPLEXITY_NODE_TYPES.has(type)) return 1;

  // switch → 按 case 数量（移植自原插件逻辑）
  if (type === 'SwitchStatement') {
    const cases = node.cases;
    return Array.isArray(cases) ? cases.length : 0;
  }

  // 逻辑赋值运算符 (&&=, ||=, ??=) → +1
  if (type === 'AssignmentExpression') {
    const op = node.operator as string;
    if (LOGICAL_ASSIGNMENT_OPS.has(op)) return 1;
  }

  return 0;
}

/**
 * 从调用表达式中提取被调用函数名。
 */
function extractCalleeName(node: ASTNode): string | null {
  let callExpr = node;
  const { type } = node;

  // ExpressionStatement → 包装了 CallExpression
  if (type === 'ExpressionStatement') {
    callExpr = (node.expression as ASTNode) ?? node;
    if ((callExpr as ASTNode).type !== 'CallExpression') return null;
  }

  if ((callExpr as ASTNode).type !== 'CallExpression') return null;

  const callee = (callExpr as ASTNode).callee as ASTNode | undefined;
  if (!callee) return null;

  // 直接调用: foo()
  if (callee.type === 'Identifier') {
    return (callee.name as string) ?? null;
  }

  // 方法调用: obj.method() 或 this.method()
  if (callee.type === 'MemberExpression') {
    const prop = callee.property as ASTNode | undefined;
    if (prop && prop.type === 'Identifier') {
      return (prop.name as string) ?? null;
    }
  }

  return null;
}

/**
 * 在 AST 中查找函数声明节点（支持 function/箭头函数/变量赋值/类方法）。
 */
function findFunctionDeclaration(
  ast: ASTNode,
  functionName: string,
): ASTNode | null {
  let found: ASTNode | null = null;

  function traverse(node: unknown): void {
    if (found) return;
    if (!isASTNode(node)) return;
    const n = node as ASTNode;

    // 直接函数声明
    if (
      (n.type === 'FunctionDeclaration' ||
        n.type === 'FunctionExpression' ||
        n.type === 'ArrowFunctionExpression')
    ) {
      const id = n.id as ASTNode | undefined | null;
      if (id && (id as ASTNode).name === functionName) {
        found = n;
        return;
      }
    }

    // const foo = function() {} / const foo = () => {}
    if (n.type === 'VariableDeclaration') {
      const declarations = n.declarations as ASTNode[];
      if (Array.isArray(declarations)) {
        for (const decl of declarations) {
          const id = decl.id as ASTNode | undefined;
          const init = decl.init as ASTNode | undefined;
          if (
            id &&
            (id as ASTNode).name === functionName &&
            init &&
            (init.type === 'FunctionExpression' || init.type === 'ArrowFunctionExpression')
          ) {
            found = init;
            return;
          }
        }
      }
    }

    // class { foo() {} }
    if (n.type === 'MethodDefinition') {
      const key = n.key as ASTNode | undefined;
      if (key && (key as ASTNode).name === functionName) {
        found = n.value as ASTNode;
        return;
      }
    }

    for (const k of getVisitorKeys(n)) {
      if (found) return;
      const child = n[k];
      if (Array.isArray(child)) {
        for (const item of child) traverse(item);
      } else {
        traverse(child);
      }
    }
  }

  traverse(ast);
  return found;
}

// ── 通用工具 ────────────────────────────────────────────────────────────────

function isASTNode(x: unknown): x is ASTNode {
  return (
    x !== null &&
    x !== undefined &&
    typeof x === 'object' &&
    typeof (x as ASTNode).type === 'string' &&
    typeof (x as ASTNode).start === 'number'
  );
}

const KEY_BLACKLIST = new Set([
  'parent',
  'leadingComments',
  'trailingComments',
  'loc',
  'range',
  'start',
  'end',
  'span',
]);

function getVisitorKeys(node: ASTNode): string[] {
  return Object.keys(node).filter(
    (k) => !KEY_BLACKLIST.has(k) && !k.startsWith('_') && k !== 'type',
  );
}

function getFunctionName(node: ASTNode, _program: ASTNode): string {
  const id = node.id as ASTNode | undefined | null;
  if (id && typeof (id as ASTNode).name === 'string') {
    return (id as ASTNode).name as string;
  }
  return '<anonymous>';
}

function getThreshold(totalLines: number): number {
  for (const item of THRESHOLD_MAP) {
    if (totalLines > item.lineScope[0] && totalLines <= item.lineScope[1]) {
      return item.thresholdValue;
    }
  }
  return THRESHOLD_MAP[THRESHOLD_MAP.length - 1].thresholdValue;
}

// ── 入口 ────────────────────────────────────────────────────────────────────
main().catch((err) => {
  log.error(`unhandled error: ${String(err)}`);
  silentExit();
});
