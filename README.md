# jacob-z-harness

个人 Claude Code / oh-my-pi 工具集仓库。

## 简介

收集和整理个人开发的 AI 代码 agent 工具、脚本和配置，以 marketplace 形式组织。

## 内容

- `plugins/claude-hooks/` — Claude Code 用户级 hooks（oxlint 门禁、复杂度检测、ESLint 自动修复、token 统计）
- `plugins/hyperpiemia/` — oh-my-pi 自建 skills（Vitest 测试框架、Whistle 代理调试、ZAPI 接口工具）
- `packages/` — 子项目（ai-chat-viewer 等）

## 仓库配置

- **GitHub（主仓库）**: `https://github.com/JacobZyy/jacob-z-harness`
  - `origin` 指向 GitHub
  - 普通 `git push` 只同步到 GitHub
- **GitLab（公司备份）**: `https://gitlab.zhuanspirit.com/zhayang/jacob-open-source`
  - 通过 `gitlab-sync` skill 临时切换推送

## 双仓库提交

- **普通提交**（仅 GitHub）：`git add -A && git commit -m "msg" && git push origin main`
- **同步 GitLab 备份**：使用 `gitlab-sync` skill（`.claude/skills/gitlab-sync/SKILL.md`）

## GitLab 代理开关

公司内网访问 GitLab 需要代理时：

```bash
# 查看状态
pnpm proxy:status

# 开启代理
pnpm proxy:on

# 关闭代理
pnpm proxy:off
```

## 使用

```bash
git clone https://github.com/JacobZyy/jacob-z-harness.git
```
