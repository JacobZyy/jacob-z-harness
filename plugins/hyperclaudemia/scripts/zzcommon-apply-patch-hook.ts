import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildZzcommonHookInput,
  extractApplyPatchFilePaths,
  parseHookInput,
} from './lib/apply-patch.ts';

const ZZCOMMON_ROOT = '/Users/jacobzha/.claude/plugins/marketplaces/zz-harness/plugins/zzcommon';
const MAX_STDIN = 1024 * 1024;

function scriptNameForEvent(eventName?: string): string | null {
  if (eventName === 'PreToolUse') return 'pre-edit.js';
  if (eventName === 'PostToolUse') return 'post-edit.js';
  return null;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let rawInput = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      if (rawInput.length >= MAX_STDIN) return;
      rawInput += chunk.slice(0, MAX_STDIN - rawInput.length);
    });
    process.stdin.on('end', () => resolve(rawInput));
  });
}

function runZzcommonScript(scriptName: string, input: string): void {
  const scriptPath = join(ZZCOMMON_ROOT, 'scripts', 'hooks', scriptName);
  if (!existsSync(scriptPath)) return;

  spawnSync(process.execPath, [scriptPath], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: ZZCOMMON_ROOT,
    },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
}

export async function main(): Promise<void> {
  const rawInput = await readStdin();
  const input = parseHookInput(rawInput);
  const targetScriptName =
    scriptNameForEvent(process.env.HYPERCLAUDEMIA_HOOK_EVENT) ??
    scriptNameForEvent(process.env.CLAUDE_HOOK_EVENT_NAME) ??
    scriptNameForEvent(input?.hook_event_name);

  if (!input?.tool_input?.patchText || !targetScriptName) {
    process.stdout.write(rawInput);
    return;
  }

  const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const filePaths = extractApplyPatchFilePaths(input.tool_input.patchText, cwd);

  for (const filePath of filePaths) {
    runZzcommonScript(targetScriptName, buildZzcommonHookInput(rawInput, filePath));
  }

  process.stdout.write(rawInput);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && currentFile === process.argv[1]) {
  main().catch(() => {
    process.exit(0);
  });
}
