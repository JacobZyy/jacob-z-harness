import { readFile, writeFile } from 'node:fs/promises'
import * as p from '@clack/prompts'
import c from 'ansis'
import {
  OPENCODE_CONFIG_PATH,
  OPENCODE_FORMATTER_ENTRY,
  OPENCODE_LSP_ENTRY,
} from '../constants.ts'
import { fileExists } from '../utils.ts'

export async function patchOpencode() {
  const configPath = OPENCODE_CONFIG_PATH
  if (!await fileExists(configPath)) {
    p.log.warn(c.yellow(`opencode config not found: ${configPath}`))
    p.log.warn(c.yellow('Skipping opencode patch. Run opencode first to generate the config file.'))
    return
  }

  const content = await readFile(configPath, 'utf-8')
  const config = JSON.parse(content) as Record<string, unknown>

  let changed = false

  if (!config.lsp || typeof config.lsp !== 'object' || Array.isArray(config.lsp)) {
    config.lsp = {}
  }

  const lsp = config.lsp as Record<string, unknown>
  if (!lsp.oxlint) {
    lsp.oxlint = { ...OPENCODE_LSP_ENTRY }
    p.log.success(c.green('Added lsp.oxlint entry'))
    changed = true
  }
  else {
    p.log.warn(c.yellow('lsp.oxlint already exists (skipped)'))
  }

  if (!config.formatter || typeof config.formatter !== 'object' || Array.isArray(config.formatter)) {
    config.formatter = {}
  }

  const formatter = config.formatter as Record<string, unknown>
  if (!formatter.oxfmt) {
    formatter.oxfmt = { ...OPENCODE_FORMATTER_ENTRY }
    p.log.success(c.green('Added formatter.oxfmt entry'))
    changed = true
  }
  else {
    p.log.warn(c.yellow('formatter.oxfmt already exists (skipped)'))
  }

  if (changed) {
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
    p.log.success(c.green(`Updated: ${configPath}`))
  }
  else {
    p.log.warn(c.yellow('No changes needed to opencode config.'))
  }
}
