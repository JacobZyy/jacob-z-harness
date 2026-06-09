import { homedir } from 'node:os'
import { join } from 'node:path'

// === 路径常量 ===
export const HOME = homedir()
export const OXC_CONFIG_DIR = `${HOME}/.config/oxc`
export const OPENCODE_CONFIG_PATH = `${HOME}/.config/opencode/opencode.json`

export const OXLINTRC_FILENAME = 'oxlintrc.json'
export const OXFMTRC_FILENAME = 'oxfmtrc.json'

export const OXLINTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXLINTRC_FILENAME)
export const OXFMTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXFMTRC_FILENAME)

export const OXLINT_BIN = join(HOME, '.bun/bin/oxlint')
export const OXFMT_BIN = join(HOME, '.bun/bin/oxfmt')

// === 公司项目 git host 标识 ===
export const COMPANY_GIT_HOST = 'gitlab.zhuanspirit.com'

// ============================================================
// 个人预设（antfu 风格）
// ============================================================

export const PERSONAL_OXLINTRC = {
  $schema: 'https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json',
  plugins: ['typescript', 'vue', 'unicorn', 'oxc', 'import', 'jsdoc'],
  categories: {
    correctness: 'error',
    suspicious: 'warn',
    pedantic: 'off',
    perf: 'warn',
    style: 'off',
    restriction: 'off',
    nursery: 'off',
  },
  rules: {
    'no-console': 'warn',
    'no-debugger': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    eqeqeq: 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' }],
    'typescript/prefer-as-const': 'error',
    'typescript/ban-ts-comment': 'error',
    'vue/valid-define-props': 'error',
    'vue/valid-define-emits': 'error',
  },
  ignorePatterns: [
    '**/*.test.*',
    '**/*.spec.*',
    '**/__tests__/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/*.d.ts',
    '**/*.config.*',
  ],
} as const

export const PERSONAL_OXFMTRC = {
  $schema: './node_modules/oxfmt/configuration_schema.json',
  semi: false,
  singleQuote: true,
  trailingComma: 'all' as const,
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  bracketSpacing: true,
  arrowParens: 'always' as const,
  endOfLine: 'lf' as const,
  insertFinalNewline: true,
  embeddedLanguageFormatting: 'auto' as const,
  htmlWhitespaceSensitivity: 'css' as const,
  proseWrap: 'preserve' as const,
  vueIndentScriptAndStyle: false,
  singleAttributePerLine: false,
  objectWrap: 'preserve' as const,
  sortImports: {
    order: 'asc' as const,
    ignoreCase: true,
    newlinesBetween: true,
    internalPattern: ['~/', '@/', '#'],
    groups: [
      'builtin',
      'external',
      ['internal', 'subpath'],
      ['parent', 'sibling', 'index'],
      'style',
      'unknown',
    ],
  },
  overrides: [
    { files: ['*.json', '*.jsonc'], options: { trailingComma: 'none' } },
    { files: ['*.md'], options: { proseWrap: 'preserve' } },
  ],
  ignorePatterns: ['node_modules/**', 'dist/**', 'build/**', '*.min.*'],
} as const

// ============================================================
// 公司预设（覆盖层，Vue/React 共用）
// ============================================================

// 公司项目在 lint 规则上的差异。
// 合并策略：公司 off → 保留个人（以你为准）；公司 on → 覆盖个人（以公司为准）
// func-call-spacing / space-before-function-paren / singleQuote 以你为准 → 不出现在此
// trailingComma 以公司为准 → 出现在 oxfmt 覆盖层
export const COMPANY_OXLINTRC_RULE_OVERRIDES: Record<string, unknown> = {
  // 公司显式开启的规则（与个人不同时，以公司为准）
  'typescript/no-unused-vars': ['error', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],

  // 公司显式关闭的规则 → 合并时跳过，个人预设生效（对 AI 更严格）
  // 'no-console': 'off'           → 个人 "warn" 生效
  // 'eqeqeq': 'off'               → 个人 "error" 生效
  // 'no-new': 'off'               → 跳过
  // 'no-param-reassign': 'off'    → 跳过
  // 'camelcase': 0                → 跳过
  // '@typescript-eslint/no-explicit-any': 'off' → 个人 "error" 生效
}

export const COMPANY_OXLINTRC_CATEGORIES = {
  correctness: 'warn',
  suspicious: 'off',
  pedantic: 'off',
  perf: 'off',
  style: 'off',
  restriction: 'off',
  nursery: 'off',
} as const

// 公司项目在格式化上的差异。
// 浅合并到个人预设上（公司值覆盖个人值）。
// trailingComma 以公司为准 → "none"
// singleQuote / space-before-function-paren / func-call-spacing 以你为准 → 不覆盖
export const COMPANY_OXFMTRC_OVERRIDES: Record<string, unknown> = {
  trailingComma: 'none',
}

// ============================================================
// opencode 配置片段
// ============================================================

export const OPENCODE_LSP_ENTRY = {
  command: [OXLINT_BIN, '--lsp'],
  extensions: ['ts', 'tsx', 'js', 'jsx', 'html', 'vue', 'json', 'md'],
} as const

export const OPENCODE_FORMATTER_ENTRY = {
  command: [OXFMT_BIN, '--lsp', '-c', OXFMTRC_GLOBAL_PATH],
  extensions: ['ts', 'tsx', 'js', 'jsx', 'html', 'vue', 'json', 'md'],
} as const

// ============================================================
// 合并函数
// ============================================================

type RuleValue = string | number | [string | number, ...unknown[]]

function isRuleOff(value: RuleValue): boolean {
  if (value === 'off' || value === 0 || value === 'allow')
    return true
  if (Array.isArray(value) && (value[0] === 'off' || value[0] === 0))
    return true
  return false
}

/**
 * 合并 oxlint rules。
 * - 公司 off → 保留个人（不覆盖）
 * - 公司 on → 覆盖个人
 */
export function mergeRules(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }
  for (const [rule, value] of Object.entries(overrides)) {
    if (isRuleOff(value as RuleValue)) {
      // 公司关了，以个人为准 → 不覆盖
      continue
    }
    // 公司开着，以公司为准
    result[rule] = value
  }
  return result
}

/**
 * 浅合并 oxfmt 配置（公司值覆盖个人值）
 */
export function mergeOxfmt(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...overrides }
}
