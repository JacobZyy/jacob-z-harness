// plugins/hyperclaudemia/__tests__/lint-runners.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSync = vi.fn();
vi.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }));

const { runEslintFix, runOxfmt, runOxlintFixCheck } = await import('../scripts/lib/lint-runners.ts');

beforeEach(() => { spawnSync.mockReset(); });

describe('runOxlintFixCheck', () => {
  it('ran=false when spawn errors (tool missing)', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' });
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj');
    expect(r.ran).toBe(false);
  });

  it('fix then check: exit 0 on check -> no remaining', () => {
    // 第一次 --fix,第二次 check
    spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // --fix
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }); // check
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj');
    expect(r).toMatchObject({ ran: true, hasRemaining: false });
  });

  it('fix then check: exit 1 on check -> remaining with output', () => {
    spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // --fix
      .mockReturnValueOnce({ status: 1, stdout: 'Found 1 error.', stderr: '' }); // check
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj');
    expect(r).toMatchObject({ ran: true, hasRemaining: true });
    expect(r.output).toContain('Found 1 error.');
  });
});

describe('runEslintFix', () => {
  it('ran=false when spawn errors', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' });
    expect(runEslintFix(['a.ts'], '/proj').ran).toBe(false);
  });

  it('exit 1 after --fix -> remaining', () => {
    spawnSync.mockReturnValue({ status: 1, stdout: 'eslint problems', stderr: '' });
    const r = runEslintFix(['a.ts'], '/proj');
    expect(r).toMatchObject({ ran: true, hasRemaining: true });
  });

  it('exit 0 after --fix -> no remaining', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    expect(runEslintFix(['a.ts'], '/proj')).toMatchObject({ ran: true, hasRemaining: false });
  });
});

describe('runOxfmt', () => {
  it('ran=false when spawn errors (oxfmt missing) — caller skips formatting', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' });
    expect(runOxfmt(['a.ts'], '/cfg/oxfmt.json', '/proj').ran).toBe(false);
  });

  it('exit 0 -> ran true', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    expect(runOxfmt(['a.ts'], '/cfg/oxfmt.json', '/proj').ran).toBe(true);
  });
});
