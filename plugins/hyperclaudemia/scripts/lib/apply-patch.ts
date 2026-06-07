import { isAbsolute, join } from 'node:path';

const PATCH_PATH_PREFIXES = [
  '*** Add File: ',
  '*** Update File: ',
  '*** Delete File: ',
  '*** Move to: ',
];

interface ToolInput {
  patchText?: string;
}

export interface HookInput {
  cwd?: string;
  hook_event_name?: string;
  tool_input?: ToolInput;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

export function parseHookInput(rawInput: string): HookInput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const toolInput = parsed.tool_input;
  const input: HookInput = {};

  const cwd = readStringField(parsed, 'cwd');
  if (cwd) input.cwd = cwd;

  const hookEventName = readStringField(parsed, 'hook_event_name');
  if (hookEventName) input.hook_event_name = hookEventName;

  if (isRecord(toolInput)) {
    const patchText = readStringField(toolInput, 'patchText');
    if (patchText) input.tool_input = { patchText };
  }

  return input;
}

export function extractApplyPatchFilePaths(patchText: string, cwd: string): string[] {
  const paths = new Set<string>();

  for (const line of patchText.split('\n')) {
    for (const prefix of PATCH_PATH_PREFIXES) {
      if (!line.startsWith(prefix)) continue;
      const rawPath = line.slice(prefix.length).trim();
      if (!rawPath) continue;
      paths.add(isAbsolute(rawPath) ? rawPath : join(cwd, rawPath));
    }
  }

  return [...paths].sort();
}

export function buildZzcommonHookInput(rawInput: string, filePath: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    return rawInput;
  }

  if (!isRecord(parsed)) return rawInput;
  const nextInput = isRecord(parsed.tool_input) ? { ...parsed.tool_input } : {};
  nextInput.file_path = filePath;

  return JSON.stringify({
    ...parsed,
    tool_input: nextInput,
  });
}
