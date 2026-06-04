// plugins/hyperclaudemia/__tests__/transcript.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProjectRoot, extractEditedFiles, groupByProjectRoot } from '../scripts/lib/transcript.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'transcript-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function transcriptLine(name: string, filePath: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input: { file_path: filePath } }] },
  });
}

describe('extractEditedFiles', () => {
  it('extracts existing .ts files touched by Edit/Write/MultiEdit', () => {
    const a = join(dir, 'a.ts');
    const b = join(dir, 'b.vue');
    writeFileSync(a, 'export const a = 1\n');
    writeFileSync(b, '<script setup lang="ts"></script>\n');
    const tp = join(dir, 't.jsonl');
    writeFileSync(tp, [
      transcriptLine('Edit', a),
      transcriptLine('Write', b),
      transcriptLine('Read', join(dir, 'ignored.ts')), // not a write tool
      transcriptLine('Edit', join(dir, 'gone.ts')), // file does not exist
    ].join('\n'));
    expect(extractEditedFiles(tp)).toEqual([a, b].sort());
  });

  it('skips non-ts extensions', () => {
    const md = join(dir, 'readme.md');
    writeFileSync(md, '# hi\n');
    const tp = join(dir, 't.jsonl');
    writeFileSync(tp, transcriptLine('Write', md));
    expect(extractEditedFiles(tp)).toEqual([]);
  });
});

describe('detectProjectRoot', () => {
  it('finds nearest ancestor with package.json', () => {
    const sub = join(dir, 'pkg', 'src');
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(dir, 'pkg', 'package.json'), '{}');
    expect(detectProjectRoot(join(sub, 'x.ts'))).toBe(join(dir, 'pkg'));
  });

  it('returns null when no package.json found', () => {
    const sub = join(dir, 'nopkg');
    mkdirSync(sub, { recursive: true });
    expect(detectProjectRoot(join(sub, 'x.ts'))).toBeNull();
  });
});

describe('groupByProjectRoot', () => {
  it('groups files under their respective project roots', () => {
    const p1 = join(dir, 'p1'); const p2 = join(dir, 'p2');
    mkdirSync(p1, { recursive: true }); mkdirSync(p2, { recursive: true });
    writeFileSync(join(p1, 'package.json'), '{}');
    writeFileSync(join(p2, 'package.json'), '{}');
    const f1 = join(p1, 'a.ts'); const f2 = join(p2, 'b.ts');
    const groups = groupByProjectRoot([f1, f2]);
    expect(groups.get(p1)).toEqual([f1]);
    expect(groups.get(p2)).toEqual([f2]);
  });

  it('drops files with no detectable project root', () => {
    const orphan = join(dir, 'orphan.ts');
    const groups = groupByProjectRoot([orphan]);
    expect(groups.size).toBe(0);
  });
});
