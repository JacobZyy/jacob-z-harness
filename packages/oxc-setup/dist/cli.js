#!/usr/bin/env node

// src/cli.ts
import process3 from "process";
import * as p5 from "@clack/prompts";
import c5 from "ansis";
import { cac } from "cac";

// src/utils.ts
import { execSync } from "child_process";
import { readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import process from "process";
import * as p from "@clack/prompts";
import c from "ansis";

// src/constants.ts
import { homedir } from "os";
import { join } from "path";
var HOME = homedir();
var OXC_CONFIG_DIR = `${HOME}/.config/oxc`;
var OPENCODE_CONFIG_PATH = `${HOME}/.config/opencode/opencode.json`;
var OXLINTRC_FILENAME = "oxlintrc.json";
var OXFMTRC_FILENAME = "oxfmtrc.json";
var OXLINTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXLINTRC_FILENAME);
var OXFMTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXFMTRC_FILENAME);
var OXLINT_BIN = join(HOME, ".bun/bin/oxlint");
var OXFMT_BIN = join(HOME, ".bun/bin/oxfmt");
var COMPANY_GIT_HOST = "gitlab.zhuanspirit.com";
var PERSONAL_OXLINTRC = {
  $schema: "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
  plugins: ["typescript", "vue", "unicorn", "oxc", "import", "jsdoc"],
  categories: {
    correctness: "error",
    suspicious: "warn",
    pedantic: "off",
    perf: "warn",
    style: "off",
    restriction: "off",
    nursery: "off"
  },
  rules: {
    "no-console": "warn",
    "no-debugger": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    eqeqeq: "error",
    "typescript/no-explicit-any": "error",
    "typescript/no-non-null-assertion": "error",
    "typescript/consistent-type-assertions": ["error", { assertionStyle: "as", objectLiteralTypeAssertions: "never" }],
    "typescript/prefer-as-const": "error",
    "typescript/ban-ts-comment": "error",
    "vue/valid-define-props": "error",
    "vue/valid-define-emits": "error"
  },
  ignorePatterns: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/__tests__/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/*.d.ts",
    "**/*.config.*"
  ]
};
var PERSONAL_OXFMTRC = {
  $schema: "./node_modules/oxfmt/configuration_schema.json",
  semi: false,
  singleQuote: true,
  trailingComma: "all",
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,
  bracketSpacing: true,
  arrowParens: "always",
  endOfLine: "lf",
  insertFinalNewline: true,
  embeddedLanguageFormatting: "auto",
  htmlWhitespaceSensitivity: "css",
  proseWrap: "preserve",
  vueIndentScriptAndStyle: false,
  singleAttributePerLine: false,
  objectWrap: "preserve",
  sortImports: {
    order: "asc",
    ignoreCase: true,
    newlinesBetween: true,
    internalPattern: ["~/", "@/", "#"],
    groups: [
      "builtin",
      "external",
      ["internal", "subpath"],
      ["parent", "sibling", "index"],
      "style",
      "unknown"
    ]
  },
  overrides: [
    { files: ["*.json", "*.jsonc"], options: { trailingComma: "none" } },
    { files: ["*.md"], options: { proseWrap: "preserve" } }
  ],
  ignorePatterns: ["node_modules/**", "dist/**", "build/**", "*.min.*"]
};
var COMPANY_OXLINTRC_RULE_OVERRIDES = {
  // 公司显式开启的规则（与个人不同时，以公司为准）
  "typescript/no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }]
  // 公司显式关闭的规则 → 合并时跳过，个人预设生效（对 AI 更严格）
  // 'no-console': 'off'           → 个人 "warn" 生效
  // 'eqeqeq': 'off'               → 个人 "error" 生效
  // 'no-new': 'off'               → 跳过
  // 'no-param-reassign': 'off'    → 跳过
  // 'camelcase': 0                → 跳过
  // '@typescript-eslint/no-explicit-any': 'off' → 个人 "error" 生效
};
var COMPANY_OXLINTRC_CATEGORIES = {
  correctness: "warn",
  suspicious: "off",
  pedantic: "off",
  perf: "off",
  style: "off",
  restriction: "off",
  nursery: "off"
};
var COMPANY_OXFMTRC_OVERRIDES = {
  trailingComma: "none"
};
var OPENCODE_LSP_ENTRY = {
  command: [OXLINT_BIN, "--lsp"],
  extensions: ["ts", "tsx", "js", "jsx", "html", "vue", "json", "md"]
};
var OPENCODE_FORMATTER_ENTRY = {
  command: [OXFMT_BIN, "--lsp", "-c", OXFMTRC_GLOBAL_PATH],
  extensions: ["ts", "tsx", "js", "jsx", "html", "vue", "json", "md"]
};
function isRuleOff(value) {
  if (value === "off" || value === 0 || value === "allow")
    return true;
  if (Array.isArray(value) && (value[0] === "off" || value[0] === 0))
    return true;
  return false;
}
function mergeRules(base, overrides) {
  const result = { ...base };
  for (const [rule, value] of Object.entries(overrides)) {
    if (isRuleOff(value)) {
      continue;
    }
    result[rule] = value;
  }
  return result;
}
function mergeOxfmt(base, overrides) {
  return { ...base, ...overrides };
}

// src/utils.ts
async function writeJson(filePath, data, options) {
  if (options?.createDir) {
    const { mkdir: mkdir2 } = await import("fs/promises");
    await mkdir2(dirname(filePath), { recursive: true });
  }
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(filePath, content, "utf-8");
}
async function fileExists(filePath) {
  try {
    const { access } = await import("fs/promises");
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
function getGitRemoteUrl() {
  try {
    return execSync("git config --get remote.origin.url", { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}
function isCompanyProject() {
  const url = getGitRemoteUrl();
  return url?.includes(COMPANY_GIT_HOST) ?? false;
}
function which(cmd) {
  try {
    return execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8" }).trim() || null;
  } catch {
    return null;
  }
}
function getNodeMajorVersion() {
  const v = process.version.replace("v", "").split(".")[0];
  return Number.parseInt(v, 10);
}
function checkAndInstallBinaries() {
  const hasOxlint = which("oxlint");
  const hasOxfmt = which("oxfmt");
  if (hasOxlint && hasOxfmt) {
    p.log.success(c.green("oxlint and oxfmt are already installed"));
    return;
  }
  const missing = [];
  if (!hasOxlint) missing.push("oxlint");
  if (!hasOxfmt) missing.push("oxfmt");
  p.log.warn(c.yellow(`Missing binaries: ${missing.join(", ")}`));
  const hasBun = which("bun");
  if (hasBun) {
    p.log.info(c.cyan("Installing via bun..."));
    try {
      execSync("bun install -g oxlint oxfmt", { stdio: "inherit" });
      p.log.success(c.green("Installed oxlint and oxfmt via bun"));
    } catch (e) {
      p.log.error(c.red(`Failed to install via bun: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
    return;
  }
  const nodeMajor = getNodeMajorVersion();
  if (nodeMajor < 18) {
    p.log.error(c.red(`Node.js ${process.version} is too old (need >= 18).`));
    p.log.error(c.red("Please upgrade Node.js or install bun: https://bun.sh"));
    process.exit(1);
  }
  p.log.info(c.cyan("Installing via npm..."));
  try {
    execSync("npm install -g oxlint oxfmt", { stdio: "inherit" });
    p.log.success(c.green("Installed oxlint and oxfmt via npm"));
  } catch (e) {
    p.log.error(c.red(`Failed to install via npm: ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

// src/commands/init.ts
import { mkdir } from "fs/promises";
import * as p2 from "@clack/prompts";
import c2 from "ansis";
async function initGlobal() {
  await mkdir(OXC_CONFIG_DIR, { recursive: true });
  p2.log.success(c2.green(`Ensured directory: ${OXC_CONFIG_DIR}`));
  const oxlintExists = await fileExists(OXLINTRC_GLOBAL_PATH);
  if (oxlintExists) {
    p2.log.warn(c2.yellow(`Already exists (skipped): ${OXLINTRC_GLOBAL_PATH}`));
  } else {
    await writeJson(OXLINTRC_GLOBAL_PATH, { ...PERSONAL_OXLINTRC });
    p2.log.success(c2.green(`Created: ${OXLINTRC_GLOBAL_PATH}`));
  }
  const oxfmtExists = await fileExists(OXFMTRC_GLOBAL_PATH);
  if (oxfmtExists) {
    p2.log.warn(c2.yellow(`Already exists (skipped): ${OXFMTRC_GLOBAL_PATH}`));
  } else {
    await writeJson(OXFMTRC_GLOBAL_PATH, { ...PERSONAL_OXFMTRC });
    p2.log.success(c2.green(`Created: ${OXFMTRC_GLOBAL_PATH}`));
  }
}

// src/commands/opencode.ts
import { readFile as readFile2, writeFile as writeFile2 } from "fs/promises";
import * as p3 from "@clack/prompts";
import c3 from "ansis";
async function patchOpencode() {
  const configPath = OPENCODE_CONFIG_PATH;
  if (!await fileExists(configPath)) {
    p3.log.warn(c3.yellow(`opencode config not found: ${configPath}`));
    p3.log.warn(c3.yellow("Skipping opencode patch. Run opencode first to generate the config file."));
    return;
  }
  const content = await readFile2(configPath, "utf-8");
  const config = JSON.parse(content);
  let changed = false;
  if (!config.lsp || typeof config.lsp !== "object" || Array.isArray(config.lsp)) {
    config.lsp = {};
  }
  const lsp = config.lsp;
  if (!lsp.oxlint) {
    lsp.oxlint = { ...OPENCODE_LSP_ENTRY };
    p3.log.success(c3.green("Added lsp.oxlint entry"));
    changed = true;
  } else {
    p3.log.warn(c3.yellow("lsp.oxlint already exists (skipped)"));
  }
  if (!config.formatter || typeof config.formatter !== "object" || Array.isArray(config.formatter)) {
    config.formatter = {};
  }
  const formatter = config.formatter;
  if (!formatter.oxfmt) {
    formatter.oxfmt = { ...OPENCODE_FORMATTER_ENTRY };
    p3.log.success(c3.green("Added formatter.oxfmt entry"));
    changed = true;
  } else {
    p3.log.warn(c3.yellow("formatter.oxfmt already exists (skipped)"));
  }
  if (changed) {
    await writeFile2(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    p3.log.success(c3.green(`Updated: ${configPath}`));
  } else {
    p3.log.warn(c3.yellow("No changes needed to opencode config."));
  }
}

// src/commands/project.ts
import process2 from "process";
import * as p4 from "@clack/prompts";
import c4 from "ansis";
function isCompanyPreset(preset) {
  return preset === "company-vue" || preset === "company-react";
}
function buildOxlintConfig(preset) {
  const base = {
    $schema: "./node_modules/oxlint/configuration_schema.json",
    plugins: [...PERSONAL_OXLINTRC.plugins],
    categories: { ...PERSONAL_OXLINTRC.categories },
    rules: { ...PERSONAL_OXLINTRC.rules },
    ignorePatterns: [...PERSONAL_OXLINTRC.ignorePatterns]
  };
  if (isCompanyPreset(preset)) {
    base.categories = { ...COMPANY_OXLINTRC_CATEGORIES };
    base.rules = mergeRules(base.rules, COMPANY_OXLINTRC_RULE_OVERRIDES);
  }
  return base;
}
function buildOxfmtConfig(preset) {
  const base = {
    $schema: "./node_modules/oxfmt/configuration_schema.json",
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
    overrides: PERSONAL_OXFMTRC.overrides.map((o) => ({ ...o, options: { ...o.options } })),
    ignorePatterns: [...PERSONAL_OXFMTRC.ignorePatterns]
  };
  if (isCompanyPreset(preset)) {
    return mergeOxfmt(base, COMPANY_OXFMTRC_OVERRIDES);
  }
  return base;
}
async function initProject(preset) {
  const cwd = process2.cwd();
  const presetLabel = isCompanyPreset(preset) ? `${preset} (merged with personal)` : "personal";
  p4.log.info(c4.dim(`Working directory: ${cwd}`));
  p4.log.info(c4.dim(`Preset: ${presetLabel}`));
  const oxlintPath = `${cwd}/.oxlintrc.json`;
  if (await fileExists(oxlintPath)) {
    p4.log.warn(c4.yellow(`Already exists (skipped): ${oxlintPath}`));
  } else {
    const oxlintConfig = buildOxlintConfig(preset);
    await writeJson(oxlintPath, oxlintConfig);
    p4.log.success(c4.green(`Created: ${oxlintPath}`));
  }
  const oxfmtPath = `${cwd}/.oxfmtrc.json`;
  if (await fileExists(oxfmtPath)) {
    p4.log.warn(c4.yellow(`Already exists (skipped): ${oxfmtPath}`));
  } else {
    const oxfmtConfig = buildOxfmtConfig(preset);
    const tc = oxfmtConfig.trailingComma;
    await writeJson(oxfmtPath, oxfmtConfig);
    p4.log.success(c4.green(`Created: ${oxfmtPath}`) + c4.dim(` (trailingComma: "${tc}")`));
  }
}
async function initProjectInteractive() {
  const company = isCompanyProject();
  if (company) {
    const { execSync: execSync2 } = await import("child_process");
    const url = execSync2("git config --get remote.origin.url", { encoding: "utf-8" }).trim();
    p4.log.success(c4.green(`Company project detected: ${url}`));
    const framework = await p4.select({
      message: "Choose framework:",
      options: [
        { label: "Vue", value: "vue" },
        { label: "React", value: "react" }
      ]
    });
    if (p4.isCancel(framework)) {
      p4.cancel("Operation cancelled.");
      process2.exit(0);
    }
    await initProject(framework === "vue" ? "company-vue" : "company-react");
  } else {
    const { execSync: execSync2 } = await import("child_process");
    let url = "(no git remote)";
    try {
      url = execSync2("git config --get remote.origin.url", { encoding: "utf-8" }).trim();
    } catch {
    }
    p4.log.info(c4.dim(`Project remote: ${url}`));
    p4.log.info(c4.cyan("Personal project \u2014 using personal preset"));
    await initProject("personal");
  }
}

// package.json
var version = "0.1.0";

// src/cli.ts
var cli = cac("oxc-setup");
cli.command("", "Interactive setup for oxlint + oxfmt").action(async () => {
  p5.intro(`${c5.green`oxc-setup`} ${c5.dim`v${version}`}`);
  const mode = await p5.select({
    message: "What would you like to configure?",
    options: [
      { label: "Global (personal) setup", value: "global", hint: "~/.config/oxc/ + opencode.json" },
      { label: "Project setup", value: "project", hint: "auto-detect company/personal" }
    ]
  });
  if (p5.isCancel(mode)) {
    p5.cancel("Operation cancelled.");
    process3.exit(0);
  }
  if (mode === "global") {
    const s = p5.spinner();
    s.start("Setting up global configs...");
    await initGlobal();
    await patchOpencode();
    s.stop("Global configs done");
    checkAndInstallBinaries();
  } else {
    const s = p5.spinner();
    s.start("Detecting project type...");
    s.stop();
    await initProjectInteractive();
    checkAndInstallBinaries();
  }
  p5.outro(c5.green("Setup completed!"));
});
cli.help();
cli.version(version);
cli.parse();
//# sourceMappingURL=cli.js.map