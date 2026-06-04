// plugins/hyperclaudemia/scripts/lib/lint-runners.ts
import { spawnSync } from 'node:child_process';

export interface RunResult {
  ran: boolean;
  hasRemaining: boolean;
  output: string;
}

function merge(r: { stdout?: string; stderr?: string }): string {
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
}

/** oxc 链:oxfmt 格式化。ran=false 表示工具不可用,调用方跳过即可。 */
export function runOxfmt(files: string[], cfgPath: string, cwd: string): RunResult {
  const r = spawnSync('oxfmt', ['-c', cfgPath, ...files], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, cwd,
  });
  if (r.error) return { ran: false, hasRemaining: false, output: `oxfmt error: ${r.error.message}` };
  return { ran: true, hasRemaining: false, output: merge(r) };
}

/** oxc 链:先 --fix 再 check。check exit 1 = 仍有 remaining。 */
export function runOxlintFixCheck(files: string[], cfgPath: string, cwd: string): RunResult {
  const fix = spawnSync('oxlint', ['--fix', '-c', cfgPath, ...files], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000, cwd,
  });
  if (fix.error) return { ran: false, hasRemaining: false, output: `oxlint error: ${fix.error.message}` };

  const check = spawnSync('oxlint', ['-c', cfgPath, ...files], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, cwd,
  });
  if (check.error) return { ran: false, hasRemaining: false, output: `oxlint error: ${check.error.message}` };
  const exit = check.status ?? -1;
  return { ran: true, hasRemaining: exit === 1, output: merge(check) };
}

/** eslint 链:--fix 自带格式化。exit 1 = 仍有 remaining,exit 2 = fatal(视为故障 fail-open)。 */
export function runEslintFix(files: string[], cwd: string): RunResult {
  const r = spawnSync('npx', ['eslint', '--fix', '--no-warn-ignored', ...files], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000, cwd,
  });
  if (r.error) return { ran: false, hasRemaining: false, output: `eslint error: ${r.error.message}` };
  const exit = r.status ?? -1;
  if (exit === 2) return { ran: false, hasRemaining: false, output: merge(r) };
  return { ran: true, hasRemaining: exit === 1, output: merge(r) };
}
