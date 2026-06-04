# CC lint 守卫向 oxlint-gate 行为对齐 — 设计文档

- 日期: 2026-06-04
- 状态: 待评审
- 涉及仓库: `jacob-z-harness`(本仓库,Claude Code 插件)
- 参考实现: `jacob-z-omp-exts/packages/oxlint-gate`(OMP 扩展,只读参考,不改动)

## 1. 背景与目标

`hyperclaudemia` 插件的 Stop hooks 里有两套 lint 相关守卫:

- `oxlint-stop.ts` — Stop 时用用户级 `~/.config/oxlint/oxlintrc.json` 跑 oxlint,**只查不修**,发现类型偷懒断言(`as any` / `as unknown as X`)就 `decision=block` 把 ts-type-discipline 协议塞回 Claude。
- `eslint-fix-stop.ts` — Stop 时用项目级 ESLint 静默 `--fix`,零 token,不向上下文输出。

另一仓库的 `oxlint-gate`(OMP 扩展)是同一守卫思路的更完整实现:实时拦截、format(oxfmt)→ lint 两段式、按项目 eslint 版本自动探测策略(eslint≥9 跑项目 eslint,否则 oxlint 兜底)、auto-fix(最多 3 次)、fail-open。

**目标:让 CC 侧的 lint 守卫在行为能力上向 oxlint-gate 看齐**,代码各写各的(不抽跨仓库公共包)。具体补齐三项能力:

1. oxfmt 格式化(作为 oxc 策略链的第一步,非独立 hook)
2. oxlint 先 `--fix` 后拦(而非只查不修)
3. 引入策略探测,决定 fix 用哪条工具链

## 2. 关键决策(均已与用户确认)

| 决策点 | 结论 |
|--------|------|
| 对齐方式 | 行为对齐为主,代码各写各的,不抽公共包 |
| oxfmt 定位 | 绑定在 oxc 策略链内部(`oxfmt → oxlint --fix`),不做独立 hook;eslint 策略链无 oxfmt(eslint 自带格式化) |
| 策略与门禁关系 | `--fix` 跑完修不掉的 **remaining 一律硬 block**,保留门禁的强制性质 |
| hook 数量 | 把 `oxlint-stop.ts` + `eslint-fix-stop.ts` 合并为单个 `lint-fix-stop.ts`,Stop 数组 4 → 3 |
| 策略缓存 | 落到项目 `.omp/lint-strategy.json`,**与 oxlint-gate 共用同一文件、同一格式**,谁先跑谁建 |
| 嗅探时机 | SessionStart 对启动 cwd 预热(对齐 oxlint-gate `session_start`);Stop 阶段按项目根分组,未命中缓存现场嗅探 |
| 跨项目 | 改动文件按项目根分组,每组独立嗅探 + 独立跑 fix(不沿用旧的取首文件根偷懒法) |
| 测试 | `__tests__/` 下新建 `lint-fix-stop` 测试(现有仅 `sample.test.ts`,无旧 lint 测试需迁移) |

## 3. 架构:两阶段

嗅探与 lint 是正交的两件事:**嗅探针对项目根**(决定用哪条工具链),**lint 针对本会话改动文件**。

### 阶段 A — SessionStart 预热(对齐 oxlint-gate 的 `session_start`)

```
SessionStart hook
  └─ 对启动 cwd 嗅探策略(读 package.json eslint 版本)
       └─ 写 .omp/lint-strategy.json(与 oxlint-gate 共用)
```

只能预热「启动 cwd」这一个项目根。多目录会话里其它项目根的策略,留到 Stop 阶段未命中时现场嗅探。

### 阶段 B — Stop 主流程(`lint-fix-stop.ts`)

```
读 stdin / 解析 transcript
  └─ 捞本会话 Edit/Write/MultiEdit 触达且仍存在的 .ts/.tsx/.mts/.cts/.vue
       │
       ▼
按项目根分组(detectProjectRoot,每个文件向上找最近 package.json)
  │
  └─ 对每个项目根分组:
       │
       ▼
     读 .omp/lint-strategy.json
       ├─ 命中合法 strategy → 直接用
       └─ 未命中 / 损坏    → 现场嗅探并回写
       │
       ├─ eslint≥9 策略 ──→ eslint --fix(项目级,自带格式化)
       │                         │
       │                         ▼
       │                    check remaining
       │
       └─ oxc 策略(否则)─→ oxfmt(读 ~/.config/oxlint/oxfmt.json)
                                 │
                                 ▼
                            ignorePatterns 过滤(Bun.Glob,读 oxlintrc)
                                 │
                                 ▼
                            oxlint --fix -c ~/.config/oxlint/oxlintrc.json
                                 │
                                 ▼
                            check remaining
       │
       ▼
汇总各组结果:
  ├─ 全部 0 violations → systemMessage 报通过,放行
  ├─ 任一组 remaining   → decision=block + 报告 + ts-type-discipline 协议
  └─ 工具没装/故障      → 该组 fail-open,systemMessage 提示跳过,不 block
```

每组各自嗅探、各自跑 fix(`spawnSync` 的 `cwd` 用该组项目根);任一组有 remaining 即 block,把所有组的报告汇总塞回 Claude。

`stop_hook_active === true` 时不重复 block(防死循环),改为 systemMessage 提示尽快修复。

## 4. 各单元职责

### 4.1 transcript 解析(复用现有逻辑)
- 输入: stdin JSON 的 `transcript_path`
- 输出: 本会话 Edit/Write/MultiEdit 触达、扩展名匹配、且 `statSync` 仍存在的文件绝对路径数组
- 依赖: 现有 `extractEditedFiles` / `isWriteTool` / `isExistingFile`,沿用不改

### 4.2 策略嗅探(移植 oxlint-gate `sniffStrategy`)
- 触发点: ① SessionStart 对启动 cwd 预热; ② Stop 阶段每个项目根分组未命中缓存时现场嗅探
- 输入: 项目根 `package.json`
- 逻辑: 读 `dependencies` + `devDependencies` 的 `eslint`,剥前缀取主版本号;主版本 ≥ 9 → `eslint` 策略,否则 → `oxc` 策略
- 缓存: 读/写项目 `.omp/lint-strategy.json`,结构与 oxlint-gate 一致(`{ strategy, eslintVersion?, sniffedAt }`);命中合法 strategy 直接用,读不出合法值(未命中/损坏/跨工具格式漂移)→ fail-safe 重新嗅探并回写
- 项目根: 沿用 `eslint-fix-stop.ts` 的 `detectProjectRoot`(从文件向上找最近 package.json)

### 4.2.1 跨项目分组(CC 特有)
- 一次会话可能编辑跨多个项目根的文件(多目录会话是常态)
- 改动文件先 `detectProjectRoot` 分组,**每组独立嗅探 + 独立跑 fix**,`spawnSync` 的 `cwd` 用该组项目根
- 不沿用 `eslint-fix-stop.ts` 旧的 `detectProjectRoot(allFiles[0])` 偷懒法(只取首个文件根,跨项目会用错策略/错 cwd)

### 4.3 oxc 策略链
1. `oxfmt <files>` — 读 `~/.config/oxlint/oxfmt.json`;没装 oxfmt → 跳过(fail-open)
2. `ignorePatterns` 过滤 — 用 `Bun.Glob` 按 oxlintrc 的 `ignorePatterns` 滤掉 `*.test.*` / `*.config.*` 等(沿用现 `loadIgnorePatterns` / `filterByIgnorePatterns`)
3. `oxlint --fix -c <oxlintrc> <files>` → 再 `oxlint -c <oxlintrc> <files>` check remaining

### 4.4 eslint 策略链
1. `eslint --fix <files>`(项目级 bin 优先,沿用 `findEslintBin`),eslint 自带格式化,无 oxfmt
2. eslint exit code 判定 remaining(1 = 有残留 lint 问题,2 = fatal)

### 4.5 结果输出(沿用现 emit/HookResponse 协议)
- stdout 写一行 JSON: `{ systemMessage, decision?, reason? }`
- remaining block 时,`reason` 用现有 ts-type-discipline 三步协议文案
- 进程恒 `exit 0`

## 5. hooks.json 变化

### SessionStart(新增策略预热)
现有 SessionStart 跑 `setup.sh`,在其后追加一个预热步骤:对启动 cwd 嗅探策略并写 `.omp/lint-strategy.json`。可并入 `setup.sh` 末尾,或新增独立脚本(倾向并入 `lint-fix-stop.ts` 暴露的嗅探函数,由一个轻量入口调用,避免逻辑两处实现)。

### Stop(数组 4 → 3)

```jsonc
"Stop": [
  { "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/lint-fix-stop.ts", "timeout": 60 }, // 合并 oxlint-stop + eslint-fix-stop
  { "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/complexity-stop.ts", "timeout": 60 }, // 不动
  { "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/token-stats-stop.ts", "timeout": 10 } // 不动
]
```

删除 `oxlint-stop.ts`、`eslint-fix-stop.ts`,新增 `lint-fix-stop.ts`。嗅探逻辑作为 `lint-fix-stop.ts` 的可导出函数,供 SessionStart 预热复用。

## 6. 测试

在 `__tests__/` 下新建 `lint-fix-stop.test.ts`,覆盖:

1. **策略嗅探分流** — package.json eslint@9 → eslint 策略;无 eslint / eslint@8 → oxc 策略;缓存命中复用;缓存损坏 → fail-safe 重嗅探
2. **跨项目分组** — 改动文件跨两个项目根 → 各自按本组策略跑 fix,cwd 用各自项目根
3. **oxc 链** — oxfmt 调用 → ignorePatterns 过滤 → oxlint --fix → check
4. **eslint 链** — eslint --fix 调用,无 oxfmt
5. **remaining 硬 block** — fix 后仍有违规 → `decision=block` + 协议文案;多组时报告汇总
6. **fail-open** — oxlint/oxfmt/eslint 未安装或 spawn error → 该组不 block,systemMessage 提示跳过
7. **防死循环** — `stop_hook_active=true` 时不重复 block

外部进程(`spawnSync`)与文件系统用 mock;策略缓存文件读写用临时目录。

## 7. 明确不做(YAGNI)

- 不抽跨仓库公共包 — 纯函数在 CC 侧重写移植即可
- 不做实时 PostToolUse lint — CC 无对应能力,维持 Stop 批量时机
- 不改动 `complexity-stop.ts` / `token-stats-stop.ts`
- 不改 `oxlint-gate` 仓库(只读参考)

## 8. 风险与边界

- **eslint≥9 项目不再走用户级 oxlintrc 类型门禁**:这类项目的 `as any` 拦截依赖项目自身 eslint 规则。这是「合并为单流水线」的固有取舍,已与用户确认接受。
- **缓存跨工具共享**:`.omp/lint-strategy.json` 与 oxlint-gate 共用。两边 `sniffStrategy` 逻辑须保持结构一致,否则一方读到另一方写的缓存会解析失败 → 须 fail-safe 到重新探测(读不出合法 strategy 就重新 sniff)。
- **oxlint 显式传文件清单不应用 ignorePatterns**:必须在 hook 层用 Bun.Glob 自己过滤,沿用现有实现。
