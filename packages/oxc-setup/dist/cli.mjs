#!/usr/bin/env node
import process from "node:process";
import * as p from "@clack/prompts";
import c from "ansis";
import { cac } from "cac";
import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
//#region src/constants.ts
const HOME = homedir();
const OXC_CONFIG_DIR = `${HOME}/.config/oxc`;
const OPENCODE_CONFIG_PATH = `${HOME}/.config/opencode/opencode.json`;
const OXLINTRC_FILENAME = "oxlintrc.json";
const OXFMTRC_FILENAME = "oxfmtrc.json";
const OXLINTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXLINTRC_FILENAME);
const OXFMTRC_GLOBAL_PATH = join(OXC_CONFIG_DIR, OXFMTRC_FILENAME);
const OXLINT_BIN = join(HOME, ".bun/bin/oxlint");
const OXFMT_BIN = join(HOME, ".bun/bin/oxfmt");
const PERSONAL_OXLINTRC = {
	$schema: "https://raw.githubusercontent.com/oxc-project/oxc/main/npm/oxlint/configuration_schema.json",
	plugins: [
		"typescript",
		"vue",
		"unicorn",
		"oxc",
		"import",
		"jsdoc"
	],
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
		"no-unused-vars": ["error", {
			argsIgnorePattern: "^_",
			varsIgnorePattern: "^_"
		}],
		eqeqeq: "error",
		"typescript/no-explicit-any": "error",
		"typescript/no-non-null-assertion": "error",
		"typescript/consistent-type-assertions": ["error", {
			assertionStyle: "as",
			objectLiteralTypeAssertions: "never"
		}],
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
const PERSONAL_OXFMTRC = {
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
		internalPattern: [
			"~/",
			"@/",
			"#"
		],
		groups: [
			"builtin",
			"external",
			["internal", "subpath"],
			[
				"parent",
				"sibling",
				"index"
			],
			"style",
			"unknown"
		]
	},
	overrides: [{
		files: ["*.json", "*.jsonc"],
		options: { trailingComma: "none" }
	}, {
		files: ["*.md"],
		options: { proseWrap: "preserve" }
	}],
	ignorePatterns: [
		"node_modules/**",
		"dist/**",
		"build/**",
		"*.min.*"
	]
};
const COMPANY_OXLINTRC_RULE_OVERRIDES = { "typescript/no-unused-vars": ["error", {
	varsIgnorePattern: "^_",
	argsIgnorePattern: "^_"
}] };
const COMPANY_OXLINTRC_CATEGORIES = {
	correctness: "warn",
	suspicious: "off",
	pedantic: "off",
	perf: "off",
	style: "off",
	restriction: "off",
	nursery: "off"
};
const COMPANY_OXFMTRC_OVERRIDES = { trailingComma: "none" };
const OPENCODE_LSP_ENTRY = {
	command: [OXLINT_BIN, "--lsp"],
	extensions: [
		"ts",
		"tsx",
		"js",
		"jsx",
		"html",
		"vue",
		"json",
		"md"
	]
};
const OPENCODE_FORMATTER_ENTRY = {
	command: [
		OXFMT_BIN,
		"--lsp",
		"-c",
		OXFMTRC_GLOBAL_PATH
	],
	extensions: [
		"ts",
		"tsx",
		"js",
		"jsx",
		"html",
		"vue",
		"json",
		"md"
	]
};
function isRuleOff(value) {
	if (value === "off" || value === 0 || value === "allow") return true;
	if (Array.isArray(value) && (value[0] === "off" || value[0] === 0)) return true;
	return false;
}
/**
* 合并 oxlint rules。
* - 公司 off → 保留个人（不覆盖）
* - 公司 on → 覆盖个人
*/
function mergeRules(base, overrides) {
	const result = { ...base };
	for (const [rule, value] of Object.entries(overrides)) {
		if (isRuleOff(value)) continue;
		result[rule] = value;
	}
	return result;
}
/**
* 浅合并 oxfmt 配置（公司值覆盖个人值）
*/
function mergeOxfmt(base, overrides) {
	return {
		...base,
		...overrides
	};
}
//#endregion
//#region src/utils.ts
async function writeJson(filePath, data, options) {
	if (options?.createDir) {
		const { mkdir } = await import("node:fs/promises");
		await mkdir(dirname(filePath), { recursive: true });
	}
	await writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}
async function fileExists(filePath) {
	try {
		const { access } = await import("node:fs/promises");
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
	return getGitRemoteUrl()?.includes("gitlab.zhuanspirit.com") ?? false;
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
	if (which("bun")) {
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
	if (getNodeMajorVersion() < 18) {
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
//#endregion
//#region src/commands/init.ts
async function initGlobal() {
	await mkdir(OXC_CONFIG_DIR, { recursive: true });
	p.log.success(c.green(`Ensured directory: ${OXC_CONFIG_DIR}`));
	if (await fileExists(OXLINTRC_GLOBAL_PATH)) p.log.warn(c.yellow(`Already exists (skipped): ${OXLINTRC_GLOBAL_PATH}`));
	else {
		await writeJson(OXLINTRC_GLOBAL_PATH, { ...PERSONAL_OXLINTRC });
		p.log.success(c.green(`Created: ${OXLINTRC_GLOBAL_PATH}`));
	}
	if (await fileExists(OXFMTRC_GLOBAL_PATH)) p.log.warn(c.yellow(`Already exists (skipped): ${OXFMTRC_GLOBAL_PATH}`));
	else {
		await writeJson(OXFMTRC_GLOBAL_PATH, { ...PERSONAL_OXFMTRC });
		p.log.success(c.green(`Created: ${OXFMTRC_GLOBAL_PATH}`));
	}
}
//#endregion
//#region src/commands/opencode.ts
async function patchOpencode() {
	const configPath = OPENCODE_CONFIG_PATH;
	if (!await fileExists(configPath)) {
		p.log.warn(c.yellow(`opencode config not found: ${configPath}`));
		p.log.warn(c.yellow("Skipping opencode patch. Run opencode first to generate the config file."));
		return;
	}
	const content = await readFile(configPath, "utf-8");
	const config = JSON.parse(content);
	let changed = false;
	if (!config.lsp || typeof config.lsp !== "object" || Array.isArray(config.lsp)) config.lsp = {};
	const lsp = config.lsp;
	if (!lsp.oxlint) {
		lsp.oxlint = { ...OPENCODE_LSP_ENTRY };
		p.log.success(c.green("Added lsp.oxlint entry"));
		changed = true;
	} else p.log.warn(c.yellow("lsp.oxlint already exists (skipped)"));
	if (!config.formatter || typeof config.formatter !== "object" || Array.isArray(config.formatter)) config.formatter = {};
	const formatter = config.formatter;
	if (!formatter.oxfmt) {
		formatter.oxfmt = { ...OPENCODE_FORMATTER_ENTRY };
		p.log.success(c.green("Added formatter.oxfmt entry"));
		changed = true;
	} else p.log.warn(c.yellow("formatter.oxfmt already exists (skipped)"));
	if (changed) {
		await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
		p.log.success(c.green(`Updated: ${configPath}`));
	} else p.log.warn(c.yellow("No changes needed to opencode config."));
}
//#endregion
//#region src/commands/project.ts
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
		overrides: PERSONAL_OXFMTRC.overrides.map((o) => ({
			...o,
			options: { ...o.options }
		})),
		ignorePatterns: [...PERSONAL_OXFMTRC.ignorePatterns]
	};
	if (isCompanyPreset(preset)) return mergeOxfmt(base, COMPANY_OXFMTRC_OVERRIDES);
	return base;
}
async function initProject(preset) {
	const cwd = process.cwd();
	const presetLabel = isCompanyPreset(preset) ? `${preset} (merged with personal)` : "personal";
	p.log.info(c.dim(`Working directory: ${cwd}`));
	p.log.info(c.dim(`Preset: ${presetLabel}`));
	const oxlintPath = `${cwd}/.oxlintrc.json`;
	if (await fileExists(oxlintPath)) p.log.warn(c.yellow(`Already exists (skipped): ${oxlintPath}`));
	else {
		await writeJson(oxlintPath, buildOxlintConfig(preset));
		p.log.success(c.green(`Created: ${oxlintPath}`));
	}
	const oxfmtPath = `${cwd}/.oxfmtrc.json`;
	if (await fileExists(oxfmtPath)) p.log.warn(c.yellow(`Already exists (skipped): ${oxfmtPath}`));
	else {
		const oxfmtConfig = buildOxfmtConfig(preset);
		const tc = oxfmtConfig.trailingComma;
		await writeJson(oxfmtPath, oxfmtConfig);
		p.log.success(c.green(`Created: ${oxfmtPath}`) + c.dim(` (trailingComma: "${tc}")`));
	}
}
async function initProjectInteractive() {
	if (isCompanyProject()) {
		const { execSync } = await import("node:child_process");
		const url = execSync("git config --get remote.origin.url", { encoding: "utf-8" }).trim();
		p.log.success(c.green(`Company project detected: ${url}`));
		const framework = await p.select({
			message: "Choose framework:",
			options: [{
				label: "Vue",
				value: "vue"
			}, {
				label: "React",
				value: "react"
			}]
		});
		if (p.isCancel(framework)) {
			p.cancel("Operation cancelled.");
			process.exit(0);
		}
		await initProject(framework === "vue" ? "company-vue" : "company-react");
	} else {
		const { execSync } = await import("node:child_process");
		let url = "(no git remote)";
		try {
			url = execSync("git config --get remote.origin.url", { encoding: "utf-8" }).trim();
		} catch {}
		p.log.info(c.dim(`Project remote: ${url}`));
		p.log.info(c.cyan("Personal project — using personal preset"));
		await initProject("personal");
	}
}
//#endregion
//#region package.json
var version = "0.1.0";
//#endregion
//#region src/cli.ts
const cli = cac("oxc-setup");
cli.command("", "Interactive setup for oxlint + oxfmt").action(async () => {
	p.intro(`${c.green`oxc-setup`} ${c.dim`v${version}`}`);
	const mode = await p.select({
		message: "What would you like to configure?",
		options: [{
			label: "Global (personal) setup",
			value: "global",
			hint: "~/.config/oxc/ + opencode.json"
		}, {
			label: "Project setup",
			value: "project",
			hint: "auto-detect company/personal"
		}]
	});
	if (p.isCancel(mode)) {
		p.cancel("Operation cancelled.");
		process.exit(0);
	}
	if (mode === "global") {
		const s = p.spinner();
		s.start("Setting up global configs...");
		await initGlobal();
		await patchOpencode();
		s.stop("Global configs done");
		checkAndInstallBinaries();
	} else {
		const s = p.spinner();
		s.start("Detecting project type...");
		s.stop();
		await initProjectInteractive();
		checkAndInstallBinaries();
	}
	p.outro(c.green("Setup completed!"));
});
cli.help();
cli.version(version);
cli.parse();
//#endregion
export {};
