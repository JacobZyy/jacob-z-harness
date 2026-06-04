// plugins/hyperclaudemia/scripts/lint-fix-stop.ts
/// <reference types="bun-types" />
import type { HookResponse, OrchestratorDeps } from './lib/lint-orchestrator.ts';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHookLogger } from './logger.ts';
import { runEslintFix, runOxfmt, runOxlintFixCheck } from './lib/lint-runners.ts';
import { filterByIgnorePatterns, loadIgnorePatterns } from './lib/oxlint-ignore.ts';
import { buildResponse, processGroups } from './lib/lint-orchestrator.ts';
import { loadStrategy } from './lib/lint-strategy.ts';
import { extractEditedFiles, groupByProjectRoot } from './lib/transcript.ts';

const log = createHookLogger('Stop', 'lint-fix-stop.ts');
const OXLINT_CFG = join(homedir(), '.config', 'oxlint', 'oxlintrc.json');
const OXFMT_CFG = join(homedir(), '.config', 'oxlint', 'oxfmt.json');

interface RunHookOptions {
  stdin: string;
  deps?: Partial<OrchestratorDeps>;
}

/** 纯函数入口,便于测试。返回 null 表示静默(无输出)。 */
export function runHook(opts: RunHookOptions): HookResponse | null {
  let input: { transcript_path?: string; stop_hook_active?: boolean } = {};
  try { input = JSON.parse(opts.stdin); } catch { return null; }

  const tp = input.transcript_path;
  if (!tp) return null;

  const files = extractEditedFiles(tp);
  if (files.length === 0) return null;

  const groups = groupByProjectRoot(files);
  if (groups.size === 0) return null;

  const deps: OrchestratorDeps = {
    loadStrategy,
    loadIgnorePatterns,
    filterByIgnorePatterns,
    runOxfmt,
    runOxlintFixCheck,
    runEslintFix,
    oxlintCfg: OXLINT_CFG,
    oxfmtCfg: OXFMT_CFG,
    ...opts.deps,
  };

  const results = processGroups(groups, deps);
  return buildResponse(results, input.stop_hook_active === true);
}

function main(): void {
  log.info('hook triggered');
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { process.exit(0); }
  if (!raw.trim()) process.exit(0);

  const resp = runHook({ stdin: raw });
  if (resp) {
    process.stdout.write(`${JSON.stringify(resp)}\n`);
    log.done(resp.decision === 'block' ? 'blocked' : 'passed', resp.decision === 'block' ? 'warn' : 'info');
  } else {
    log.done('silent (no edited files / no transcript)');
  }
  process.exit(0);
}

// 仅在直接执行时跑 main;被测试 import 时不跑
if (import.meta.main) main();
