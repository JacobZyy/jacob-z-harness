// plugins/hyperclaudemia/scripts/lib/lint-strategy.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type LintStrategy = 'eslint' | 'oxlint';

export interface LintStrategyCache {
  strategy: LintStrategy;
  eslintVersion?: string;
  sniffedAt: string;
}

const memCache = new Map<string, LintStrategyCache>();

function cachePath(cwd: string): string {
  return join(cwd, '.omp', 'lint-strategy.json');
}

function sniffEslintVersion(cwd: string): string | undefined {
  try {
    const pkgPath = join(cwd, 'package.json');
    if (!existsSync(pkgPath)) return undefined;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
    const deps = {
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.dependencies as Record<string, string> | undefined),
    };
    const raw = deps.eslint;
    if (!raw) return undefined;
    const clean = raw.replace(/^\D*/, '');
    return clean || undefined;
  } catch {
    return undefined;
  }
}

function isEslintGte(version: string, major: number): boolean {
  const v = Number.parseInt(version.split('.')[0] ?? '0', 10);
  return !Number.isNaN(v) && v >= major;
}

export function sniffStrategy(cwd: string): LintStrategyCache {
  const eslintVersion = sniffEslintVersion(cwd);
  const strategy: LintStrategy = eslintVersion && isEslintGte(eslintVersion, 9) ? 'eslint' : 'oxlint';
  const cache: LintStrategyCache = { strategy, eslintVersion, sniffedAt: new Date().toISOString() };
  try {
    const ompDir = join(cwd, '.omp');
    if (!existsSync(ompDir)) mkdirSync(ompDir, { recursive: true });
    writeFileSync(cachePath(cwd), JSON.stringify(cache, null, 2));
  } catch {
    // non-critical
  }
  return cache;
}

export function loadStrategy(cwd: string): LintStrategyCache {
  const mem = memCache.get(cwd);
  if (mem) return mem;

  const p = cachePath(cwd);
  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf8')) as LintStrategyCache;
      if (data.strategy === 'eslint' || data.strategy === 'oxlint') {
        memCache.set(cwd, data);
        return data;
      }
    } catch {
      // corrupt — fall through to re-sniff
    }
  }
  const result = sniffStrategy(cwd);
  memCache.set(cwd, result);
  return result;
}
