# hyperclaudemia

Claude Code 用户级 hooks 插件：lint 门禁（策略嗅探 + 自动修复 + 残留硬拦）+ token 消耗记录。

## Hook 列表

| 事件         | 脚本                      | 说明                                                                                                  |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| SessionStart | `setup.sh`                | 检查 Prisma client 就绪，未就绪则自动 install + generate + db push                                    |
| SessionStart | `lint-strategy-warmup.ts` | 预热当前项目的 lint 策略并写入 `.omp/lint-strategy.json` 缓存                                         |
| PostToolUse  | `token-stats-tool.ts`     | 记录每次工具调用的名称、结果 token 估算到 SQLite                                                      |
| Stop         | `lint-fix-stop.ts`        | 按项目根分组改动文件，嗅探策略走 `eslint --fix` 或 `oxfmt → oxlint --fix`，修复后仍有残留违规则 block |
| Stop         | `token-stats-stop.ts`     | 记录每轮对话的 token 消耗（input/output/cache）到 SQLite                                              |

## 前置条件

- **bun** — 用于运行 TypeScript hooks
- **oxlint / oxfmt** — oxc 策略下的格式化与类型断言检查（eslint<9 或无 eslint 的项目）
- **oxlintrc 配置** — `~/.config/oxlint/oxlintrc.json`、`~/.config/oxlint/oxfmt.json`（lint-fix-stop 读取）
- **eslint≥9** — eslint 策略下的项目直接走项目级 `eslint --fix`

## 数据存储

- **SQLite**: `~/.claude/data/token-stats.db`
- 由 `setup.sh` 自动创建，通过 Prisma 管理 schema

## 版本更新

`plugin.json` 和 `.claude-plugin/marketplace.json` 的版本号必须同步更新，否则 Claude Code 的自动更新机制不会触发。
