import { describe, expect, it } from 'vitest';
import {
  buildZzcommonHookInput,
  extractApplyPatchFilePaths,
  parseHookInput,
} from '../scripts/lib/apply-patch.ts';

describe('extractApplyPatchFilePaths', () => {
  it('extracts add/update/delete/move paths as absolute paths', () => {
    const cwd = '/repo';
    const patchText = [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const n = 1',
      '*** Update File: src/old.ts',
      '*** Move to: src/renamed.ts',
      '@@',
      '-old',
      '+new',
      '*** Delete File: /tmp/abs.ts',
      '*** End Patch',
    ].join('\n');

    expect(extractApplyPatchFilePaths(patchText, cwd)).toEqual([
      '/repo/src/new.ts',
      '/repo/src/old.ts',
      '/repo/src/renamed.ts',
      '/tmp/abs.ts',
    ]);
  });
});

describe('parseHookInput', () => {
  it('reads cwd and patchText from hook input', () => {
    const input = parseHookInput(JSON.stringify({
      cwd: '/repo',
      tool_input: { patchText: '*** Begin Patch\n*** End Patch' },
    }));

    expect(input).toEqual({
      cwd: '/repo',
      tool_input: { patchText: '*** Begin Patch\n*** End Patch' },
    });
  });

  it('reads hook_event_name when present', () => {
    expect(parseHookInput(JSON.stringify({ hook_event_name: 'PostToolUse' }))).toEqual({
      hook_event_name: 'PostToolUse',
    });
  });

  it('returns null for invalid JSON', () => {
    expect(parseHookInput('{')).toBeNull();
  });
});

describe('buildZzcommonHookInput', () => {
  it('preserves original input and injects tool_input.file_path', () => {
    const raw = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: { patchText: 'patch' },
    });

    expect(JSON.parse(buildZzcommonHookInput(raw, '/repo/src/a.ts'))).toEqual({
      hook_event_name: 'PreToolUse',
      tool_name: 'apply_patch',
      tool_input: {
        patchText: 'patch',
        file_path: '/repo/src/a.ts',
      },
    });
  });
});
