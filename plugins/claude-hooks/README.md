# claude-hooks

Claude Code 用户级 hooks 插件：oxlint 类型偷懒断言门禁 + token 消耗记录。

## Hook 列表

| 事件         | 脚本                  | 说明                                                               |
| ------------ | --------------------- | ------------------------------------------------------------------ |
| SessionStart | `setup.sh`            | 检查 Prisma client 就绪，未就绪则自动 install + generate + db push |
| PostToolUse  | `token-stats-tool.ts` | 记录每次工具调用的名称、结果 token 估算到 SQLite                   |
| Stop         | `oxlint-stop.ts`      | 用 oxlint 检查本会话改动的 TS 文件中的类型偷懒断言                 |
| Stop         | `token-stats-stop.ts` | 记录每轮对话的 token 消耗（input/output/cache）到 SQLite           |

## 前置条件

- **bun** — 用于运行 TypeScript hooks
- **oxlint** — 用于类型断言检查（仅 oxlint-stop 需要）
- **oxlintrc 配置** — `~/.config/oxlint/oxlintrc.json`（oxlint-stop 读取）

## 数据存储

- **SQLite**: `~/.claude/data/token-stats.db`
- 由 `setup.sh` 自动创建，通过 Prisma 管理 schema

## 版本更新

`plugin.json` 和 `.claude-plugin/marketplace.json` 的版本号必须同步更新，否则 Claude Code 的自动更新机制不会触发。
