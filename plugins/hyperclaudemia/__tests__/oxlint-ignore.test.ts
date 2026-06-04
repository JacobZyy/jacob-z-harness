// plugins/hyperclaudemia/__tests__/oxlint-ignore.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterByIgnorePatterns, loadIgnorePatterns } from '../scripts/lib/oxlint-ignore.ts';

// 最小 Bun.Glob 桩:把 glob 转成简单正则,够覆盖 *.test.* / **/*.config.*
class FakeGlob {
  private re: RegExp;
  constructor(pattern: string) {
    const r = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DS}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DS\}\}/g, '.*');
    this.re = new RegExp(`^${r}$`);
  }
  match(s: string): boolean { return this.re.test(s); }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxignore-'));
  vi.stubGlobal('Bun', { Glob: FakeGlob });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('loadIgnorePatterns', () => {
  it('reads ignorePatterns array from oxlintrc', () => {
    const cfg = join(dir, 'oxlintrc.json');
    writeFileSync(cfg, JSON.stringify({ ignorePatterns: ['*.test.ts', '*.config.ts'] }));
    expect(loadIgnorePatterns(cfg)).toEqual(['*.test.ts', '*.config.ts']);
  });

  it('returns [] when file missing or no ignorePatterns', () => {
    expect(loadIgnorePatterns(join(dir, 'nope.json'))).toEqual([]);
  });
});

describe('filterByIgnorePatterns', () => {
  it('drops files matching a pattern, keeps others', () => {
    const keep = join(process.cwd(), 'src/index.ts');
    const drop = join(process.cwd(), 'src/foo.test.ts');
    const out = filterByIgnorePatterns([keep, drop], ['*.test.ts']);
    expect(out).toEqual([keep]);
  });

  it('returns all files when patterns empty', () => {
    const files = [join(process.cwd(), 'a.ts')];
    expect(filterByIgnorePatterns(files, [])).toEqual(files);
  });
});
