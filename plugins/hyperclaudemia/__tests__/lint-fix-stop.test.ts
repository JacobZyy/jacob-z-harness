// plugins/hyperclaudemia/__tests__/lint-fix-stop.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHook } from '../scripts/lint-fix-stop.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lintfix-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function setupProject(strategy: 'eslint' | 'oxlint'): { root: string; file: string } {
  const root = join(dir, 'proj');
  mkdirSync(join(root, '.omp'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, '.omp', 'lint-strategy.json'), JSON.stringify({ strategy, sniffedAt: '' }));
  const file = join(root, 'a.ts');
  writeFileSync(file, 'export const a = 1\n');
  return { root, file };
}

function writeTranscript(file: string): string {
  const tp = join(dir, 't.jsonl');
  writeFileSync(tp, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
  }));
  return tp;
}

describe('runHook (装配 smoke)', () => {
  it('no transcript -> silent (null response)', () => {
    expect(runHook({ stdin: '{}' })).toBeNull();
  });

  it('clean group -> systemMessage pass, no block', () => {
    const { file } = setupProject('oxlint');
    const tp = writeTranscript(file);
    const resp = runHook({
      stdin: JSON.stringify({ transcript_path: tp }),
      // 注入全 clean 执行器
      deps: {
        runOxfmt: () => ({ ran: true, hasRemaining: false, output: '' }),
        runOxlintFixCheck: () => ({ ran: true, hasRemaining: false, output: '' }),
        runEslintFix: () => ({ ran: true, hasRemaining: false, output: '' }),
        loadIgnorePatterns: () => [],
        filterByIgnorePatterns: (f: string[]) => f,
      },
    });
    expect(resp?.decision).toBeUndefined();
    expect(resp?.systemMessage).toContain('通过');
  });

  it('remaining -> decision=block', () => {
    const { file } = setupProject('oxlint');
    const tp = writeTranscript(file);
    const resp = runHook({
      stdin: JSON.stringify({ transcript_path: tp }),
      deps: {
        runOxfmt: () => ({ ran: true, hasRemaining: false, output: '' }),
        runOxlintFixCheck: () => ({ ran: true, hasRemaining: true, output: 'Found 1 error.' }),
        runEslintFix: () => ({ ran: true, hasRemaining: false, output: '' }),
        loadIgnorePatterns: () => [],
        filterByIgnorePatterns: (f: string[]) => f,
      },
    });
    expect(resp?.decision).toBe('block');
  });
});
