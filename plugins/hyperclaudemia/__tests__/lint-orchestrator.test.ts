// plugins/hyperclaudemia/__tests__/lint-orchestrator.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildResponse, processGroups } from '../scripts/lib/lint-orchestrator.ts';

// 注入桩:策略 + 执行器,全部可控
function makeDeps(over: Partial<Parameters<typeof processGroups>[1]> = {}) {
  return {
    loadStrategy: vi.fn(() => ({ strategy: 'oxlint' as const, sniffedAt: '' })),
    loadIgnorePatterns: vi.fn(() => [] as string[]),
    filterByIgnorePatterns: vi.fn((f: string[]) => f),
    runOxfmt: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    runOxlintFixCheck: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    runEslintFix: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    oxlintCfg: '/cfg/oxlintrc.json',
    oxfmtCfg: '/cfg/oxfmt.json',
    ...over,
  };
}

describe('processGroups', () => {
  it('oxlint strategy: runs oxfmt then oxlint, no remaining -> clean group', () => {
    const deps = makeDeps();
    const groups = new Map([['/p1', ['/p1/a.ts']]]);
    const results = processGroups(groups, deps);
    expect(deps.runOxfmt).toHaveBeenCalledOnce();
    expect(deps.runOxlintFixCheck).toHaveBeenCalledOnce();
    expect(deps.runEslintFix).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ root: '/p1', blocked: false });
  });

  it('eslint strategy: runs eslint only, no oxfmt/oxlint', () => {
    const deps = makeDeps({ loadStrategy: vi.fn(() => ({ strategy: 'eslint' as const, sniffedAt: '' })) });
    const groups = new Map([['/p2', ['/p2/b.ts']]]);
    processGroups(groups, deps);
    expect(deps.runEslintFix).toHaveBeenCalledOnce();
    expect(deps.runOxfmt).not.toHaveBeenCalled();
    expect(deps.runOxlintFixCheck).not.toHaveBeenCalled();
  });

  it('oxc: ignorePatterns filter empties group -> skip oxlint run', () => {
    const deps = makeDeps({ filterByIgnorePatterns: vi.fn(() => [] as string[]) });
    const groups = new Map([['/p1', ['/p1/a.test.ts']]]);
    const results = processGroups(groups, deps);
    expect(deps.runOxlintFixCheck).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ root: '/p1', blocked: false });
  });

  it('remaining -> group blocked with output', () => {
    const deps = makeDeps({
      runOxlintFixCheck: vi.fn(() => ({ ran: true, hasRemaining: true, output: 'Found 2 errors.' })),
    });
    const groups = new Map([['/p1', ['/p1/a.ts']]]);
    const results = processGroups(groups, deps);
    expect(results[0]).toMatchObject({ root: '/p1', blocked: true });
    expect(results[0].output).toContain('Found 2 errors.');
  });

  it('tool not available (ran=false) -> fail-open, not blocked', () => {
    const deps = makeDeps({
      runOxlintFixCheck: vi.fn(() => ({ ran: false, hasRemaining: false, output: 'oxlint error: ENOENT' })),
    });
    const groups = new Map([['/p1', ['/p1/a.ts']]]);
    expect(processGroups(groups, deps)[0]).toMatchObject({ blocked: false, ran: false });
  });
});

describe('buildResponse', () => {
  it('all clean -> systemMessage pass, no decision', () => {
    const resp = buildResponse([{ root: '/p1', blocked: false, ran: true, output: '' }], false);
    expect(resp.decision).toBeUndefined();
    expect(resp.systemMessage).toContain('通过');
  });

  it('blocked group -> decision=block + protocol in reason', () => {
    const resp = buildResponse([{ root: '/p1', blocked: true, ran: true, output: 'Found 1 error.' }], false);
    expect(resp.decision).toBe('block');
    expect(resp.reason).toContain('ts-type-discipline');
    expect(resp.reason).toContain('Found 1 error.');
  });

  it('blocked but stop_hook_active -> no block, just systemMessage', () => {
    const resp = buildResponse([{ root: '/p1', blocked: true, ran: true, output: 'Found 1 error.' }], true);
    expect(resp.decision).toBeUndefined();
    expect(resp.systemMessage).toContain('Found 1 error.');
  });

  it('fail-open only (ran=false, not blocked) -> skip systemMessage, no block', () => {
    const resp = buildResponse([{ root: '/p1', blocked: false, ran: false, output: '' }], false);
    expect(resp.decision).toBeUndefined();
    expect(resp.systemMessage).toContain('跳过');
  });
});
