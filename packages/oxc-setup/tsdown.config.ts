import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  target: 'node20',
  banner: {
    js: '#!/usr/bin/env node',
  },
  deps: {
    neverBundle: [
      '@clack/prompts',
      'ansis',
      'cac',
    ],
  },
})
