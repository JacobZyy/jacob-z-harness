// plugins/hyperclaudemia/scripts/lib/lint-orchestrator.ts
import type { LintStrategyCache } from './lint-strategy.ts';
import type { RunResult } from './lint-runners.ts';

export interface GroupResult {
  root: string;
  blocked: boolean;
  ran: boolean;
  output: string;
}

export interface HookResponse {
  systemMessage: string;
  decision?: 'block';
  reason?: string;
}

export interface OrchestratorDeps {
  loadStrategy: (cwd: string) => LintStrategyCache;
  loadIgnorePatterns: (cfgPath: string) => string[];
  filterByIgnorePatterns: (files: string[], patterns: string[]) => string[];
  runOxfmt: (files: string[], cfgPath: string, cwd: string) => RunResult;
  runOxlintFixCheck: (files: string[], cfgPath: string, cwd: string) => RunResult;
  runEslintFix: (files: string[], cwd: string) => RunResult;
  oxlintCfg: string;
  oxfmtCfg: string;
}

export function processGroups(
  groups: Map<string, string[]>,
  deps: OrchestratorDeps,
): GroupResult[] {
  const results: GroupResult[] = [];
  for (const [root, files] of groups) {
    const { strategy } = deps.loadStrategy(root);

    if (strategy === 'eslint') {
      const r = deps.runEslintFix(files, root);
      results.push({ root, blocked: r.ran && r.hasRemaining, ran: r.ran, output: r.output });
      continue;
    }

    // oxc 链:oxfmt(尽力) → ignore 过滤 → oxlint --fix + check
    deps.runOxfmt(files, deps.oxfmtCfg, root);
    const kept = deps.filterByIgnorePatterns(files, deps.loadIgnorePatterns(deps.oxlintCfg));
    if (kept.length === 0) {
      results.push({ root, blocked: false, ran: true, output: '' });
      continue;
    }
    const r = deps.runOxlintFixCheck(kept, deps.oxlintCfg, root);
    results.push({ root, blocked: r.ran && r.hasRemaining, ran: r.ran, output: r.output });
  }
  return results;
}

const PROTOCOL = [
  '按 ts-type-discipline 协议处理:',
  '  1) 优先用泛型 / 条件类型 / 类型守卫消除断言,禁止 as any / as unknown as X',
  '  2) 类型体操无效 → 追溯并修复底层类型声明(接口/DTO/类型定义)',
  '  3) 若是后端接口少返回字段 → 用 AskUserQuestion 与用户确认方案',
].join('\n');

export function buildResponse(results: GroupResult[], stopHookActive: boolean): HookResponse {
  const blocked = results.filter((r) => r.blocked);
  const failOpen = results.filter((r) => !r.ran);

  if (blocked.length === 0) {
    if (failOpen.length > 0) {
      return { systemMessage: `⚠️ [lint] ${failOpen.length} 个项目的 lint 工具不可用,已跳过` };
    }
    return { systemMessage: `✅ [lint] 检查通过(${results.length} 个项目组,0 残留违规)` };
  }

  const report = blocked.map((b) => `# ${b.root}\n${b.output}`).join('\n\n');
  const summary = `❌ [lint] 修复后仍有残留违规(${blocked.length} 个项目组)`;

  if (stopHookActive) {
    return { systemMessage: `${summary}(本轮不再阻断,请尽快修复)\n\n${report}` };
  }

  const reason = ['lint 修复后仍有残留违规:', '', report, '', PROTOCOL].join('\n');
  return { systemMessage: summary, decision: 'block', reason };
}
