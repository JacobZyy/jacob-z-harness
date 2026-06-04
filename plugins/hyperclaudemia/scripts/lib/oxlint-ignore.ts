// plugins/hyperclaudemia/scripts/lib/oxlint-ignore.ts
/// <reference types="bun-types" />
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

interface OxlintConfig { ignorePatterns?: string[] }

export function loadIgnorePatterns(cfgPath: string): string[] {
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as OxlintConfig;
    if (!Array.isArray(cfg.ignorePatterns)) return [];
    return cfg.ignorePatterns.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

export function filterByIgnorePatterns(files: string[], patterns: string[]): string[] {
  if (patterns.length === 0) return files;
  const matchers = patterns.map((p) => new Bun.Glob(p));
  return files.filter((absPath) => {
    const rel = relative(process.cwd(), absPath);
    const basename = absPath.split('/').pop() ?? absPath;
    const candidates = [absPath, rel, `./${rel}`, basename];
    for (const matcher of matchers) {
      for (const c of candidates) {
        if (matcher.match(c)) return false;
      }
    }
    return true;
  });
}
