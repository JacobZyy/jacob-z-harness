// plugins/hyperclaudemia/scripts/lib/transcript.ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const TS_EXTENSIONS = /\.(?:ts|tsx|mts|cts|vue)$/;

interface TranscriptBlock { type: string; name?: string; input?: { file_path?: string } }
interface TranscriptLine { type?: string; message?: { content?: TranscriptBlock[] } }

function isWriteTool(name?: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit';
}

function isExistingFile(p: string): boolean {
  try { return statSync(p).isFile(); } catch { return false; }
}

export function extractEditedFiles(transcriptPath: string): string[] {
  let raw = '';
  try { raw = readFileSync(transcriptPath, 'utf8'); } catch { return []; }
  const set = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: TranscriptLine;
    try { parsed = JSON.parse(line) as TranscriptLine; } catch { continue; }
    if (parsed.type !== 'assistant') continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use' || !isWriteTool(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp !== 'string' || !TS_EXTENSIONS.test(fp) || !isExistingFile(fp)) continue;
      set.add(fp);
    }
  }
  return [...set].sort();
}

export function detectProjectRoot(filePath: string): string | null {
  let dir = filePath;
  for (let i = 0; i < 20; i++) {
    const parent = join(dir, '..');
    if (parent === dir) break;
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = parent;
  }
  return null;
}

export function groupByProjectRoot(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const root = detectProjectRoot(join(f, '..'));
    if (!root) continue;
    const list = groups.get(root) ?? [];
    list.push(f);
    groups.set(root, list);
  }
  return groups;
}
