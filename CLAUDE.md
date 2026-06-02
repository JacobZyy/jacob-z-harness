# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

个人 Claude Code / oh-my-pi 工具集仓库。收集和整理个人开发的 AI 代码 agent 工具、脚本和配置。

- 仓库: GitHub `https://github.com/JacobZyy/jacob-z-harness`
- 包管理: pnpm
- 类型: ESM (`"type": "module"`)

## Common Commands

```bash
# 安装依赖
pnpm install

# 代码检查
pnpm lint          # 运行 ESLint
pnpm lint:fix      # 自动修复 ESLint 问题
```

## Code Style

- ESLint: `@antfu/eslint-config@8.2.0` with `formatters: true`
- 配置文件: `eslint.config.js` (ESM 格式)
- `pnpm lint:fix` 会自动排序 JSON keys、格式化代码等
- 提交前运行 `pnpm lint:fix` 确保代码通过检查

## Repository Workflow

```bash
git add -A
git commit -m "提交信息"
git push origin main
```

## Project Structure

```
.claude-plugin/         # Marketplace 声明
  marketplace.json
plugins/                # 插件
  claude-hooks/         # oxlint 门禁 + token 消耗记录
  hyperpiemia/          # oh-my-pi skills（vitest、whistle、zapi）
packages/               # 子项目
eslint.config.js        # ESLint 配置 (ESM)
vitest.config.ts        # Vitest 测试配置
```

## Notes

- `.omc/`、`.omo/`、`coverage/`、`node_modules/` 在 `.gitignore` 中，不会被提交
- `.idea/` 目录包含 IntelliJ IDEA 配置，已纳入版本控制
- 测试框架: Vitest，运行 `pnpm test` 执行测试
