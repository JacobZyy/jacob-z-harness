import process from 'node:process'
import * as p from '@clack/prompts'
import c from 'ansis'
import {
  COMPANY_OXFMTRC_OVERRIDES,
  COMPANY_OXLINTRC_CATEGORIES,
  COMPANY_OXLINTRC_RULE_OVERRIDES,
  PERSONAL_OXFMTRC,
  PERSONAL_OXLINTRC,
  mergeOxfmt,
  mergeRules,
} from '../constants.ts'
import {
  fileExists,
  isCompanyProject,
  writeJson,
} from '../utils.ts'

export type ProjectPreset = 'personal' | 'company-vue' | 'company-react'

function isCompanyPreset(preset: ProjectPreset): boolean {
  return preset === 'company-vue' || preset === 'company-react'
}

function buildOxlintConfig(preset: ProjectPreset): Record<string, unknown> {
  const base: Record<string, unknown> = {
    $schema: './node_modules/oxlint/configuration_schema.json',
    plugins: [...PERSONAL_OXLINTRC.plugins],
    categories: { ...PERSONAL_OXLINTRC.categories },
    rules: { ...PERSONAL_OXLINTRC.rules },
    ignorePatterns: [...PERSONAL_OXLINTRC.ignorePatterns],
  }

  if (isCompanyPreset(preset)) {
    base.categories = { ...COMPANY_OXLINTRC_CATEGORIES }
    base.rules = mergeRules(base.rules as Record<string, unknown>, COMPANY_OXLINTRC_RULE_OVERRIDES)
  }

  return base
}

function buildOxfmtConfig(preset: ProjectPreset): Record<string, unknown> {
  const base: Record<string, unknown> = {
    $schema: './node_modules/oxfmt/configuration_schema.json',
    semi: PERSONAL_OXFMTRC.semi,
    singleQuote: PERSONAL_OXFMTRC.singleQuote,
    trailingComma: PERSONAL_OXFMTRC.trailingComma,
    tabWidth: PERSONAL_OXFMTRC.tabWidth,
    useTabs: PERSONAL_OXFMTRC.useTabs,
    printWidth: PERSONAL_OXFMTRC.printWidth,
    bracketSpacing: PERSONAL_OXFMTRC.bracketSpacing,
    arrowParens: PERSONAL_OXFMTRC.arrowParens,
    endOfLine: PERSONAL_OXFMTRC.endOfLine,
    insertFinalNewline: PERSONAL_OXFMTRC.insertFinalNewline,
    embeddedLanguageFormatting: PERSONAL_OXFMTRC.embeddedLanguageFormatting,
    htmlWhitespaceSensitivity: PERSONAL_OXFMTRC.htmlWhitespaceSensitivity,
    proseWrap: PERSONAL_OXFMTRC.proseWrap,
    vueIndentScriptAndStyle: PERSONAL_OXFMTRC.vueIndentScriptAndStyle,
    singleAttributePerLine: PERSONAL_OXFMTRC.singleAttributePerLine,
    objectWrap: PERSONAL_OXFMTRC.objectWrap,
    sortImports: { ...PERSONAL_OXFMTRC.sortImports },
    overrides: PERSONAL_OXFMTRC.overrides.map(o => ({ ...o, options: { ...o.options } })),
    ignorePatterns: [...PERSONAL_OXFMTRC.ignorePatterns],
  }

  if (isCompanyPreset(preset)) {
    return mergeOxfmt(base, COMPANY_OXFMTRC_OVERRIDES)
  }

  return base
}

export async function initProject(preset: ProjectPreset) {
  const cwd = process.cwd()

  const presetLabel = isCompanyPreset(preset)
    ? `${preset} (merged with personal)`
    : 'personal'

  p.log.info(c.dim(`Working directory: ${cwd}`))
  p.log.info(c.dim(`Preset: ${presetLabel}`))

  const oxlintPath = `${cwd}/.oxlintrc.json`
  if (await fileExists(oxlintPath)) {
    p.log.warn(c.yellow(`Already exists (skipped): ${oxlintPath}`))
  }
  else {
    const oxlintConfig = buildOxlintConfig(preset)
    await writeJson(oxlintPath, oxlintConfig)
    p.log.success(c.green(`Created: ${oxlintPath}`))
  }

  const oxfmtPath = `${cwd}/.oxfmtrc.json`
  if (await fileExists(oxfmtPath)) {
    p.log.warn(c.yellow(`Already exists (skipped): ${oxfmtPath}`))
  }
  else {
    const oxfmtConfig = buildOxfmtConfig(preset)
    const tc = oxfmtConfig.trailingComma as string
    await writeJson(oxfmtPath, oxfmtConfig)
    p.log.success(c.green(`Created: ${oxfmtPath}`) + c.dim(` (trailingComma: "${tc}")`))
  }
}

export async function initProjectInteractive() {
  const company = isCompanyProject()

  if (company) {
    const { execSync } = await import('node:child_process')
    const url = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim()
    p.log.success(c.green(`Company project detected: ${url}`))

    const framework = await p.select({
      message: 'Choose framework:',
      options: [
        { label: 'Vue', value: 'vue' },
        { label: 'React', value: 'react' },
      ],
    })

    if (p.isCancel(framework)) {
      p.cancel('Operation cancelled.')
      process.exit(0)
    }

    await initProject(framework === 'vue' ? 'company-vue' : 'company-react')
  }
  else {
    const { execSync } = await import('node:child_process')
    let url = '(no git remote)'
    try {
      url = execSync('git config --get remote.origin.url', { encoding: 'utf-8' }).trim()
    }
    catch { /* not a git repo */ }
    p.log.info(c.dim(`Project remote: ${url}`))
    p.log.info(c.cyan('Personal project — using personal preset'))
    await initProject('personal')
  }
}
