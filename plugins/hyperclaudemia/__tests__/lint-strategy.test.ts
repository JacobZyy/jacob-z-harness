// plugins/hyperclaudemia/__tests__/lint-strategy.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadStrategy, sniffStrategy } from '../scripts/lib/lint-strategy.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lint-strat-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writePkg(deps: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }));
}

function writeCache(strategy: string): void {
  mkdirSync(join(dir, '.omp'), { recursive: true });
  writeFileSync(
    join(dir, '.omp', 'lint-strategy.json'),
    JSON.stringify({ strategy, sniffedAt: '2026-01-01T00:00:00Z' }),
  );
}

describe('sniffStrategy', () => {
  it('eslint>=9 in devDependencies -> eslint', () => {
    writePkg({ eslint: '^9.1.0' });
    expect(sniffStrategy(dir).strategy).toBe('eslint');
  });

  it('eslint@8 -> oxlint', () => {
    writePkg({ eslint: '^8.50.0' });
    expect(sniffStrategy(dir).strategy).toBe('oxlint');
  });

  it('no eslint dep -> oxlint', () => {
    writePkg({ typescript: '^5.0.0' });
    expect(sniffStrategy(dir).strategy).toBe('oxlint');
  });

  it('no package.json -> oxlint', () => {
    expect(sniffStrategy(dir).strategy).toBe('oxlint');
  });
});

describe('loadStrategy cache', () => {
  it('writes .omp/lint-strategy.json on first sniff', () => {
    writePkg({ eslint: '^9.0.0' });
    loadStrategy(dir);
    expect(existsSync(join(dir, '.omp', 'lint-strategy.json'))).toBe(true);
  });

  it('reads valid cache without re-sniffing package.json', () => {
    // package.json 是 eslint@8(应嗅探为 oxlint),但缓存写的是 eslint
    // 若 loadStrategy 走缓存,结果应为 eslint,证明没有重新嗅探 package.json
    writePkg({ eslint: '^8.0.0' });
    writeCache('eslint');
    expect(loadStrategy(dir).strategy).toBe('eslint');
  });

  it('re-sniffs when cache is corrupt', () => {
    writePkg({ eslint: '^9.0.0' });
    mkdirSync(join(dir, '.omp'), { recursive: true });
    writeFileSync(join(dir, '.omp', 'lint-strategy.json'), 'NOT JSON');
    expect(loadStrategy(dir).strategy).toBe('eslint');
  });
});
