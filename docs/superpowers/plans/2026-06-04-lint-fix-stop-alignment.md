# lint-fix-stop 行为对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `hyperclaudemia` 的 `oxlint-stop.ts` + `eslint-fix-stop.ts` 合并为单个 `lint-fix-stop.ts`,补齐策略嗅探、oxfmt 格式化、先 fix 后拦三项能力,行为向 `oxlint-gate` 看齐。

**Architecture:** 两阶段。SessionStart 对启动 cwd 嗅探策略并写 `.omp/lint-strategy.json`(与 oxlint-gate 共用);Stop 阶段把本会话改动文件按项目根分组,每组读缓存/现嗅探决定走 eslint 链(`eslint --fix`)还是 oxc 链(`oxfmt → oxlint --fix`),fix 后仍有 remaining 则硬 block。可复用纯逻辑拆成 `scripts/lib/` 下独立模块以便 vitest 单测。

**Tech Stack:** Bun(运行时,`bun run --bun`)、vitest(node 环境测试)、`spawnSync`、`Bun.Glob`(ignore 匹配,测试用 `vi.stubGlobal` 注入桩)。

---

## 文件结构

| 文件                              | 职责                                                                |
| --------------------------------- | ------------------------------------------------------------------- |
| `scripts/lib/lint-strategy.ts`    | 嗅探 package.json eslint 版本 + `.omp/lint-strategy.json` 缓存读写  |
| `scripts/lib/transcript.ts`       | 解析 transcript 取改动文件 + 按项目根分组                           |
| `scripts/lib/oxlint-ignore.ts`    | `Bun.Glob` 按 oxlintrc ignorePatterns 过滤                          |
| `scripts/lib/lint-runners.ts`     | `runEslintFix` / `runOxfmt` / `runOxlintFixCheck` 的 spawnSync 封装 |
| `scripts/lint-fix-stop.ts`        | Stop 入口,编排分组 → 策略 → fix → 汇总 → emit                       |
| `scripts/lint-strategy-warmup.ts` | SessionStart 预热入口,对 cwd 调 loadStrategy                        |
| `__tests__/lint-strategy.test.ts` | 嗅探 + 缓存测试                                                     |
| `__tests__/transcript.test.ts`    | 解析 + 分组测试                                                     |
| `__tests__/oxlint-ignore.test.ts` | ignore 过滤测试                                                     |
| `__tests__/lint-fix-stop.test.ts` | 入口编排集成测试                                                    |

**移除:** `scripts/oxlint-stop.ts`、`scripts/eslint-fix-stop.ts`(逻辑迁入新模块)。

---

## Task 1: 策略嗅探 + 缓存模块

与 oxlint-gate 共用 `.omp/lint-strategy.json`,结构必须一致:`{ strategy: 'eslint'|'oxlint', eslintVersion?, sniffedAt }`。注意缓存里 strategy 值沿用 oxlint-gate 的 `'eslint'`/`'oxlint'` 字面量(不是 `'oxc'`),保证跨工具复用不踩格式漂移。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lib/lint-strategy.ts`
- Test: `plugins/hyperclaudemia/__tests__/lint-strategy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/lint-strategy.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadStrategy, sniffStrategy } from '../scripts/lib/lint-strategy.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lint-strat-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function writePkg(deps: Record<string, string>): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }))
}

function writeCache(strategy: string): void {
  mkdirSync(join(dir, '.omp'), { recursive: true })
  writeFileSync(
    join(dir, '.omp', 'lint-strategy.json'),
    JSON.stringify({ strategy, sniffedAt: '2026-01-01T00:00:00Z' }),
  )
}

describe('sniffStrategy', () => {
  it('eslint>=9 in devDependencies -> eslint', () => {
    writePkg({ eslint: '^9.1.0' })
    expect(sniffStrategy(dir).strategy).toBe('eslint')
  })

  it('eslint@8 -> oxlint', () => {
    writePkg({ eslint: '^8.50.0' })
    expect(sniffStrategy(dir).strategy).toBe('oxlint')
  })

  it('no eslint dep -> oxlint', () => {
    writePkg({ typescript: '^5.0.0' })
    expect(sniffStrategy(dir).strategy).toBe('oxlint')
  })

  it('no package.json -> oxlint', () => {
    expect(sniffStrategy(dir).strategy).toBe('oxlint')
  })
})

describe('loadStrategy cache', () => {
  it('writes .omp/lint-strategy.json on first sniff', () => {
    writePkg({ eslint: '^9.0.0' })
    loadStrategy(dir)
    expect(existsSync(join(dir, '.omp', 'lint-strategy.json'))).toBe(true)
  })

  it('reads valid cache without re-sniffing package.json', () => {
    // package.json 是 eslint@8(应嗅探为 oxlint),但缓存写的是 eslint
    // 若 loadStrategy 走缓存,结果应为 eslint,证明没有重新嗅探 package.json
    writePkg({ eslint: '^8.0.0' })
    writeCache('eslint')
    expect(loadStrategy(dir).strategy).toBe('eslint')
  })

  it('re-sniffs when cache is corrupt', () => {
    writePkg({ eslint: '^9.0.0' })
    mkdirSync(join(dir, '.omp'), { recursive: true })
    writeFileSync(join(dir, '.omp', 'lint-strategy.json'), 'NOT JSON')
    expect(loadStrategy(dir).strategy).toBe('eslint')
  })
})
```

> 注:`loadStrategy` 有进程级 memCache。每个用例的 `dir` 由 `beforeEach` 经 `mkdtempSync` 新建,key 唯一不重复,无需手动清理 memCache。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/jacobzha/Documents/workspace/jacob-open-source/jacob-z-harness && bun run test -- lint-strategy`
Expected: FAIL — `Cannot find module '../scripts/lib/lint-strategy.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/hyperclaudemia/scripts/lib/lint-strategy.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type LintStrategy = 'eslint' | 'oxlint'

export interface LintStrategyCache {
  strategy: LintStrategy
  eslintVersion?: string
  sniffedAt: string
}

const memCache = new Map<string, LintStrategyCache>()

function cachePath(cwd: string): string {
  return join(cwd, '.omp', 'lint-strategy.json')
}

function sniffEslintVersion(cwd: string): string | undefined {
  try {
    const pkgPath = join(cwd, 'package.json')
    if (!existsSync(pkgPath))
      return undefined
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const deps = {
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.dependencies as Record<string, string> | undefined),
    }
    const raw = deps.eslint
    if (!raw)
      return undefined
    const clean = raw.replace(/^\D*/, '')
    return clean || undefined
  }
  catch {
    return undefined
  }
}

function isEslintGte(version: string, major: number): boolean {
  const v = Number.parseInt(version.split('.')[0] ?? '0', 10)
  return !Number.isNaN(v) && v >= major
}

export function sniffStrategy(cwd: string): LintStrategyCache {
  const eslintVersion = sniffEslintVersion(cwd)
  const strategy: LintStrategy = eslintVersion && isEslintGte(eslintVersion, 9) ? 'eslint' : 'oxlint'
  const cache: LintStrategyCache = { strategy, eslintVersion, sniffedAt: new Date().toISOString() }
  try {
    const ompDir = join(cwd, '.omp')
    if (!existsSync(ompDir))
      mkdirSync(ompDir, { recursive: true })
    writeFileSync(cachePath(cwd), JSON.stringify(cache, null, 2))
  }
  catch {
    // non-critical
  }
  return cache
}

export function loadStrategy(cwd: string): LintStrategyCache {
  const mem = memCache.get(cwd)
  if (mem)
    return mem

  const p = cachePath(cwd)
  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, 'utf8')) as LintStrategyCache
      if (data.strategy === 'eslint' || data.strategy === 'oxlint') {
        memCache.set(cwd, data)
        return data
      }
    }
    catch {
      // corrupt — fall through to re-sniff
    }
  }
  const result = sniffStrategy(cwd)
  memCache.set(cwd, result)
  return result
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- lint-strategy`
Expected: PASS（4 + 3 用例全绿）

- [ ] **Step 5: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lib/lint-strategy.ts plugins/hyperclaudemia/__tests__/lint-strategy.test.ts
git commit -m "feat(hyperclaudemia): 新增 lint 策略嗅探 + .omp 缓存模块"
```

---

## Task 2: transcript 解析 + 按项目根分组

迁移现有 `extractEditedFiles`/`isWriteTool`/`isExistingFile`/`detectProjectRoot`,新增 `groupByProjectRoot`。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lib/transcript.ts`
- Test: `plugins/hyperclaudemia/__tests__/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/transcript.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectProjectRoot, extractEditedFiles, groupByProjectRoot } from '../scripts/lib/transcript.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'transcript-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function transcriptLine(name: string, filePath: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input: { file_path: filePath } }] },
  })
}

describe('extractEditedFiles', () => {
  it('extracts existing .ts files touched by Edit/Write/MultiEdit', () => {
    const a = join(dir, 'a.ts')
    const b = join(dir, 'b.vue')
    writeFileSync(a, 'export const a = 1\n')
    writeFileSync(b, '<script setup lang="ts"></script>\n')
    const tp = join(dir, 't.jsonl')
    writeFileSync(tp, [
      transcriptLine('Edit', a),
      transcriptLine('Write', b),
      transcriptLine('Read', join(dir, 'ignored.ts')), // not a write tool
      transcriptLine('Edit', join(dir, 'gone.ts')), // file does not exist
    ].join('\n'))
    expect(extractEditedFiles(tp)).toEqual([a, b].sort())
  })

  it('skips non-ts extensions', () => {
    const md = join(dir, 'readme.md')
    writeFileSync(md, '# hi\n')
    const tp = join(dir, 't.jsonl')
    writeFileSync(tp, transcriptLine('Write', md))
    expect(extractEditedFiles(tp)).toEqual([])
  })
})

describe('detectProjectRoot', () => {
  it('finds nearest ancestor with package.json', () => {
    const sub = join(dir, 'pkg', 'src')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(dir, 'pkg', 'package.json'), '{}')
    expect(detectProjectRoot(join(sub, 'x.ts'))).toBe(join(dir, 'pkg'))
  })

  it('returns null when no package.json found', () => {
    const sub = join(dir, 'nopkg')
    mkdirSync(sub, { recursive: true })
    expect(detectProjectRoot(join(sub, 'x.ts'))).toBeNull()
  })
})

describe('groupByProjectRoot', () => {
  it('groups files under their respective project roots', () => {
    const p1 = join(dir, 'p1'); const p2 = join(dir, 'p2')
    mkdirSync(p1, { recursive: true }); mkdirSync(p2, { recursive: true })
    writeFileSync(join(p1, 'package.json'), '{}')
    writeFileSync(join(p2, 'package.json'), '{}')
    const f1 = join(p1, 'a.ts'); const f2 = join(p2, 'b.ts')
    const groups = groupByProjectRoot([f1, f2])
    expect(groups.get(p1)).toEqual([f1])
    expect(groups.get(p2)).toEqual([f2])
  })

  it('drops files with no detectable project root', () => {
    const orphan = join(dir, 'orphan.ts')
    const groups = groupByProjectRoot([orphan])
    expect(groups.size).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- transcript`
Expected: FAIL — `Cannot find module '../scripts/lib/transcript.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/hyperclaudemia/scripts/lib/transcript.ts
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const TS_EXTENSIONS = /\.(?:ts|tsx|mts|cts|vue)$/

interface TranscriptBlock { type: string, name?: string, input?: { file_path?: string } }
interface TranscriptLine { type?: string, message?: { content?: TranscriptBlock[] } }

function isWriteTool(name?: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit'
}

function isExistingFile(p: string): boolean {
  try { return statSync(p).isFile() }
  catch { return false }
}

export function extractEditedFiles(transcriptPath: string): string[] {
  let raw = ''
  try { raw = readFileSync(transcriptPath, 'utf8') }
  catch { return [] }
  const set = new Set<string>()
  for (const line of raw.split('\n')) {
    if (!line.trim())
      continue
    let parsed: TranscriptLine
    try { parsed = JSON.parse(line) as TranscriptLine }
    catch { continue }
    if (parsed.type !== 'assistant')
      continue
    const content = parsed.message?.content
    if (!Array.isArray(content))
      continue
    for (const block of content) {
      if (block.type !== 'tool_use' || !isWriteTool(block.name))
        continue
      const fp = block.input?.file_path
      if (typeof fp !== 'string' || !TS_EXTENSIONS.test(fp) || !isExistingFile(fp))
        continue
      set.add(fp)
    }
  }
  return [...set].sort()
}

export function detectProjectRoot(filePath: string): string | null {
  let dir = filePath
  for (let i = 0; i < 20; i++) {
    const parent = join(dir, '..')
    if (parent === dir)
      break
    if (existsSync(join(dir, 'package.json')))
      return dir
    dir = parent
  }
  return null
}

export function groupByProjectRoot(files: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const f of files) {
    const root = detectProjectRoot(join(f, '..'))
    if (!root)
      continue
    const list = groups.get(root) ?? []
    list.push(f)
    groups.set(root, list)
  }
  return groups
}
```

> 注:`groupByProjectRoot` 对每个文件用 `detectProjectRoot(join(f,'..'))` 从文件所在目录起找,避免把文件自身当目录。`detectProjectRoot` 测试里传的是文件路径,其循环首轮检查 `dir` 自身目录是否含 package.json——传文件路径时首轮 `existsSync(join(file,'package.json'))` 为假,次轮上溯到真实目录,语义正确。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- transcript`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lib/transcript.ts plugins/hyperclaudemia/__tests__/transcript.test.ts
git commit -m "feat(hyperclaudemia): 新增 transcript 解析 + 按项目根分组模块"
```

---

## Task 3: oxlint ignore 过滤模块（Bun.Glob + stub）

迁移现有 `loadIgnorePatterns`/`filterByIgnorePatterns`。运行时用 `Bun.Glob`;vitest(node)下用 `vi.stubGlobal('Bun', ...)` 注入一个最小 Glob 桩。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lib/oxlint-ignore.ts`
- Test: `plugins/hyperclaudemia/__tests__/oxlint-ignore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/oxlint-ignore.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filterByIgnorePatterns, loadIgnorePatterns } from '../scripts/lib/oxlint-ignore.ts'

// 最小 Bun.Glob 桩:把 glob 转成简单正则,够覆盖 *.test.* / **/*.config.*
class FakeGlob {
  private re: RegExp
  constructor(pattern: string) {
    const r = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DS}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\{\{DS\}\}/g, '.*')
    this.re = new RegExp(`^${r}$`)
  }

  match(s: string): boolean { return this.re.test(s) }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oxignore-'))
  vi.stubGlobal('Bun', { Glob: FakeGlob })
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
})

describe('loadIgnorePatterns', () => {
  it('reads ignorePatterns array from oxlintrc', () => {
    const cfg = join(dir, 'oxlintrc.json')
    writeFileSync(cfg, JSON.stringify({ ignorePatterns: ['*.test.ts', '*.config.ts'] }))
    expect(loadIgnorePatterns(cfg)).toEqual(['*.test.ts', '*.config.ts'])
  })

  it('returns [] when file missing or no ignorePatterns', () => {
    expect(loadIgnorePatterns(join(dir, 'nope.json'))).toEqual([])
  })
})

describe('filterByIgnorePatterns', () => {
  it('drops files matching a pattern, keeps others', () => {
    const keep = join(process.cwd(), 'src/index.ts')
    const drop = join(process.cwd(), 'src/foo.test.ts')
    const out = filterByIgnorePatterns([keep, drop], ['*.test.ts'])
    expect(out).toEqual([keep])
  })

  it('returns all files when patterns empty', () => {
    const files = [join(process.cwd(), 'a.ts')]
    expect(filterByIgnorePatterns(files, [])).toEqual(files)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- oxlint-ignore`
Expected: FAIL — `Cannot find module '../scripts/lib/oxlint-ignore.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/hyperclaudemia/scripts/lib/oxlint-ignore.ts
/// <reference types="bun-types" />
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

interface OxlintConfig { ignorePatterns?: string[] }

export function loadIgnorePatterns(cfgPath: string): string[] {
  try {
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as OxlintConfig
    if (!Array.isArray(cfg.ignorePatterns))
      return []
    return cfg.ignorePatterns.filter((p): p is string => typeof p === 'string')
  }
  catch {
    return []
  }
}

export function filterByIgnorePatterns(files: string[], patterns: string[]): string[] {
  if (patterns.length === 0)
    return files
  const matchers = patterns.map(p => new Bun.Glob(p))
  return files.filter((absPath) => {
    const rel = relative(process.cwd(), absPath)
    const basename = absPath.split('/').pop() ?? absPath
    // 补 basename:像 `*.test.ts`(无 `**/` 前缀)的 pattern,glob 的 `*` 不跨 `/`,
    // 对 `src/foo.test.ts` 这类相对路径匹配不上,只能靠 basename 命中。
    // 真实 oxlintrc 多用 `**/*.test.*`,basename 不影响其匹配。
    const candidates = [absPath, rel, `./${rel}`, basename]
    for (const matcher of matchers) {
      for (const c of candidates) {
        if (matcher.match(c))
          return false
      }
    }
    return true
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- oxlint-ignore`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lib/oxlint-ignore.ts plugins/hyperclaudemia/__tests__/oxlint-ignore.test.ts
git commit -m "feat(hyperclaudemia): 新增 oxlint ignore 过滤模块"
```

---

## Task 4: lint runners（spawnSync 封装）

封装三个执行器,返回结构化结果。`spawnSync` 在测试里用 `vi.mock('node:child_process')` 模拟,不依赖真实 oxlint/oxfmt/eslint 二进制。

定义统一结果类型:

```ts
export interface RunResult {
  /** 执行器是否成功跑起来(spawn 没出错)。false = 工具没装/故障 → 调用方 fail-open */
  ran: boolean
  /** check 阶段是否仍有 remaining 违规 */
  hasRemaining: boolean
  /** 合并的 stdout+stderr,供 block 报告用 */
  output: string
}
```

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lib/lint-runners.ts`
- Test: `plugins/hyperclaudemia/__tests__/lint-runners.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/lint-runners.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnSync = vi.fn()
vi.mock('node:child_process', () => ({ spawnSync: (...a: unknown[]) => spawnSync(...a) }))

const { runEslintFix, runOxfmt, runOxlintFixCheck } = await import('../scripts/lib/lint-runners.ts')

beforeEach(() => { spawnSync.mockReset() })

describe('runOxlintFixCheck', () => {
  it('ran=false when spawn errors (tool missing)', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' })
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj')
    expect(r.ran).toBe(false)
  })

  it('fix then check: exit 0 on check -> no remaining', () => {
    // 第一次 --fix,第二次 check
    spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // --fix
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // check
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj')
    expect(r).toMatchObject({ ran: true, hasRemaining: false })
  })

  it('fix then check: exit 1 on check -> remaining with output', () => {
    spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // --fix
      .mockReturnValueOnce({ status: 1, stdout: 'Found 1 error.', stderr: '' }) // check
    const r = runOxlintFixCheck(['a.ts'], '/cfg/oxlintrc.json', '/proj')
    expect(r).toMatchObject({ ran: true, hasRemaining: true })
    expect(r.output).toContain('Found 1 error.')
  })
})

describe('runEslintFix', () => {
  it('ran=false when spawn errors', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' })
    expect(runEslintFix(['a.ts'], '/proj').ran).toBe(false)
  })

  it('exit 1 after --fix -> remaining', () => {
    spawnSync.mockReturnValue({ status: 1, stdout: 'eslint problems', stderr: '' })
    const r = runEslintFix(['a.ts'], '/proj')
    expect(r).toMatchObject({ ran: true, hasRemaining: true })
  })

  it('exit 0 after --fix -> no remaining', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    expect(runEslintFix(['a.ts'], '/proj')).toMatchObject({ ran: true, hasRemaining: false })
  })
})

describe('runOxfmt', () => {
  it('ran=false when spawn errors (oxfmt missing) — caller skips formatting', () => {
    spawnSync.mockReturnValue({ error: new Error('ENOENT'), status: null, stdout: '', stderr: '' })
    expect(runOxfmt(['a.ts'], '/cfg/oxfmt.json', '/proj').ran).toBe(false)
  })

  it('exit 0 -> ran true', () => {
    spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    expect(runOxfmt(['a.ts'], '/cfg/oxfmt.json', '/proj').ran).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- lint-runners`
Expected: FAIL — `Cannot find module '../scripts/lib/lint-runners.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/hyperclaudemia/scripts/lib/lint-runners.ts
import { spawnSync } from 'node:child_process'

export interface RunResult {
  ran: boolean
  hasRemaining: boolean
  output: string
}

function merge(r: { stdout?: string, stderr?: string }): string {
  return `${r.stdout ?? ''}${r.stderr ?? ''}`.trim()
}

/** oxc 链:oxfmt 格式化。ran=false 表示工具不可用,调用方跳过即可。 */
export function runOxfmt(files: string[], cfgPath: string, cwd: string): RunResult {
  const r = spawnSync('oxfmt', ['-c', cfgPath, ...files], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    cwd,
  })
  if (r.error)
    return { ran: false, hasRemaining: false, output: `oxfmt error: ${r.error.message}` }
  return { ran: true, hasRemaining: false, output: merge(r) }
}

/** oxc 链:先 --fix 再 check。check exit 1 = 仍有 remaining。 */
export function runOxlintFixCheck(files: string[], cfgPath: string, cwd: string): RunResult {
  const fix = spawnSync('oxlint', ['--fix', '-c', cfgPath, ...files], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    cwd,
  })
  if (fix.error)
    return { ran: false, hasRemaining: false, output: `oxlint error: ${fix.error.message}` }

  const check = spawnSync('oxlint', ['-c', cfgPath, ...files], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    cwd,
  })
  if (check.error)
    return { ran: false, hasRemaining: false, output: `oxlint error: ${check.error.message}` }
  const exit = check.status ?? -1
  return { ran: true, hasRemaining: exit === 1, output: merge(check) }
}

/** eslint 链:--fix 自带格式化。exit 1 = 仍有 remaining,exit 2 = fatal(视为故障 fail-open)。 */
export function runEslintFix(files: string[], cwd: string): RunResult {
  const r = spawnSync('npx', ['eslint', '--fix', '--no-warn-ignored', ...files], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    cwd,
  })
  if (r.error)
    return { ran: false, hasRemaining: false, output: `eslint error: ${r.error.message}` }
  const exit = r.status ?? -1
  if (exit === 2)
    return { ran: false, hasRemaining: false, output: merge(r) }
  return { ran: true, hasRemaining: exit === 1, output: merge(r) }
}
```

> 注:eslint 用 `npx eslint` 与现有 `eslint-fix-stop.ts` 的 fallback 一致;若要优先项目级 bin,入口层可在 Task 5 用 `findEslintBin` 解析后传入——本 runner 保持简单走 npx。实现后若 Task 5 需要项目 bin,再扩 runner 签名加可选 `bin` 参数。

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- lint-runners`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lib/lint-runners.ts plugins/hyperclaudemia/__tests__/lint-runners.test.ts
git commit -m "feat(hyperclaudemia): 新增 eslint/oxfmt/oxlint 执行器封装"
```

---

## Task 5: 编排核心（纯函数,无 IO）

把「按组跑策略 → 汇总 → 生成 HookResponse」的决策逻辑做成纯函数,执行器通过参数注入,便于测试不碰真实进程。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lib/lint-orchestrator.ts`
- Test: `plugins/hyperclaudemia/__tests__/lint-orchestrator.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/lint-orchestrator.test.ts
import { describe, expect, it, vi } from 'vitest'
import { buildResponse, processGroups } from '../scripts/lib/lint-orchestrator.ts'

// 注入桩:策略 + 执行器,全部可控
function makeDeps(over: Partial<Parameters<typeof processGroups>[1]> = {}) {
  return {
    loadStrategy: vi.fn(() => ({ strategy: 'oxlint' as const, sniffedAt: '' })),
    loadIgnorePatterns: vi.fn(() => [] as string[]),
    filterByIgnorePatterns: vi.fn((f: string[]) => f),
    runOxfmt: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    runOxlintFixCheck: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    runEslintFix: vi.fn(() => ({ ran: true, hasRemaining: false, output: '' })),
    oxlintCfg: '/cfg/oxlintrc.json',
    oxfmtCfg: '/cfg/oxfmt.json',
    ...over,
  }
}

describe('processGroups', () => {
  it('oxlint strategy: runs oxfmt then oxlint, no remaining -> clean group', () => {
    const deps = makeDeps()
    const groups = new Map([['/p1', ['/p1/a.ts']]])
    const results = processGroups(groups, deps)
    expect(deps.runOxfmt).toHaveBeenCalledOnce()
    expect(deps.runOxlintFixCheck).toHaveBeenCalledOnce()
    expect(deps.runEslintFix).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ root: '/p1', blocked: false })
  })

  it('eslint strategy: runs eslint only, no oxfmt/oxlint', () => {
    const deps = makeDeps({ loadStrategy: vi.fn(() => ({ strategy: 'eslint' as const, sniffedAt: '' })) })
    const groups = new Map([['/p2', ['/p2/b.ts']]])
    processGroups(groups, deps)
    expect(deps.runEslintFix).toHaveBeenCalledOnce()
    expect(deps.runOxfmt).not.toHaveBeenCalled()
    expect(deps.runOxlintFixCheck).not.toHaveBeenCalled()
  })

  it('oxc: ignorePatterns filter empties group -> skip oxlint run', () => {
    const deps = makeDeps({ filterByIgnorePatterns: vi.fn(() => [] as string[]) })
    const groups = new Map([['/p1', ['/p1/a.test.ts']]])
    const results = processGroups(groups, deps)
    expect(deps.runOxlintFixCheck).not.toHaveBeenCalled()
    expect(results[0]).toMatchObject({ root: '/p1', blocked: false })
  })

  it('remaining -> group blocked with output', () => {
    const deps = makeDeps({
      runOxlintFixCheck: vi.fn(() => ({ ran: true, hasRemaining: true, output: 'Found 2 errors.' })),
    })
    const groups = new Map([['/p1', ['/p1/a.ts']]])
    const results = processGroups(groups, deps)
    expect(results[0]).toMatchObject({ root: '/p1', blocked: true })
    expect(results[0].output).toContain('Found 2 errors.')
  })

  it('tool not available (ran=false) -> fail-open, not blocked', () => {
    const deps = makeDeps({
      runOxlintFixCheck: vi.fn(() => ({ ran: false, hasRemaining: false, output: 'oxlint error: ENOENT' })),
    })
    const groups = new Map([['/p1', ['/p1/a.ts']]])
    expect(processGroups(groups, deps)[0]).toMatchObject({ blocked: false, ran: false })
  })
})

describe('buildResponse', () => {
  it('all clean -> systemMessage pass, no decision', () => {
    const resp = buildResponse([{ root: '/p1', blocked: false, ran: true, output: '' }], false)
    expect(resp.decision).toBeUndefined()
    expect(resp.systemMessage).toContain('通过')
  })

  it('blocked group -> decision=block + protocol in reason', () => {
    const resp = buildResponse([{ root: '/p1', blocked: true, ran: true, output: 'Found 1 error.' }], false)
    expect(resp.decision).toBe('block')
    expect(resp.reason).toContain('ts-type-discipline')
    expect(resp.reason).toContain('Found 1 error.')
  })

  it('blocked but stop_hook_active -> no block, just systemMessage', () => {
    const resp = buildResponse([{ root: '/p1', blocked: true, ran: true, output: 'Found 1 error.' }], true)
    expect(resp.decision).toBeUndefined()
    expect(resp.systemMessage).toContain('Found 1 error.')
  })

  it('fail-open only (ran=false, not blocked) -> skip systemMessage, no block', () => {
    const resp = buildResponse([{ root: '/p1', blocked: false, ran: false, output: '' }], false)
    expect(resp.decision).toBeUndefined()
    expect(resp.systemMessage).toContain('跳过')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- lint-orchestrator`
Expected: FAIL — `Cannot find module '../scripts/lib/lint-orchestrator.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RunResult } from './lint-runners.ts'
// plugins/hyperclaudemia/scripts/lib/lint-orchestrator.ts
import type { LintStrategyCache } from './lint-strategy.ts'

export interface GroupResult {
  root: string
  blocked: boolean
  ran: boolean
  output: string
}

export interface HookResponse {
  systemMessage: string
  decision?: 'block'
  reason?: string
}

export interface OrchestratorDeps {
  loadStrategy: (cwd: string) => LintStrategyCache
  loadIgnorePatterns: (cfgPath: string) => string[]
  filterByIgnorePatterns: (files: string[], patterns: string[]) => string[]
  runOxfmt: (files: string[], cfgPath: string, cwd: string) => RunResult
  runOxlintFixCheck: (files: string[], cfgPath: string, cwd: string) => RunResult
  runEslintFix: (files: string[], cwd: string) => RunResult
  oxlintCfg: string
  oxfmtCfg: string
}

export function processGroups(
  groups: Map<string, string[]>,
  deps: OrchestratorDeps,
): GroupResult[] {
  const results: GroupResult[] = []
  for (const [root, files] of groups) {
    const { strategy } = deps.loadStrategy(root)

    if (strategy === 'eslint') {
      const r = deps.runEslintFix(files, root)
      results.push({ root, blocked: r.ran && r.hasRemaining, ran: r.ran, output: r.output })
      continue
    }

    // oxc 链:oxfmt(尽力) → ignore 过滤 → oxlint --fix + check
    deps.runOxfmt(files, deps.oxfmtCfg, root)
    const kept = deps.filterByIgnorePatterns(files, deps.loadIgnorePatterns(deps.oxlintCfg))
    if (kept.length === 0) {
      results.push({ root, blocked: false, ran: true, output: '' })
      continue
    }
    const r = deps.runOxlintFixCheck(kept, deps.oxlintCfg, root)
    results.push({ root, blocked: r.ran && r.hasRemaining, ran: r.ran, output: r.output })
  }
  return results
}

const PROTOCOL = [
  '按 ts-type-discipline 协议处理:',
  '  1) 优先用泛型 / 条件类型 / 类型守卫消除断言,禁止 as any / as unknown as X',
  '  2) 类型体操无效 → 追溯并修复底层类型声明(接口/DTO/类型定义)',
  '  3) 若是后端接口少返回字段 → 用 AskUserQuestion 与用户确认方案',
].join('\n')

export function buildResponse(results: GroupResult[], stopHookActive: boolean): HookResponse {
  const blocked = results.filter(r => r.blocked)
  const failOpen = results.filter(r => !r.ran)

  if (blocked.length === 0) {
    if (failOpen.length > 0) {
      return { systemMessage: `⚠️ [lint] ${failOpen.length} 个项目的 lint 工具不可用,已跳过` }
    }
    return { systemMessage: `✅ [lint] 检查通过(${results.length} 个项目组,0 残留违规)` }
  }

  const report = blocked.map(b => `# ${b.root}\n${b.output}`).join('\n\n')
  const summary = `❌ [lint] 修复后仍有残留违规(${blocked.length} 个项目组)`

  if (stopHookActive) {
    return { systemMessage: `${summary}(本轮不再阻断,请尽快修复)\n\n${report}` }
  }

  const reason = ['lint 修复后仍有残留违规:', '', report, '', PROTOCOL].join('\n')
  return { systemMessage: summary, decision: 'block', reason }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- lint-orchestrator`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lib/lint-orchestrator.ts plugins/hyperclaudemia/__tests__/lint-orchestrator.test.ts
git commit -m "feat(hyperclaudemia): 新增 lint 编排核心(分组策略分流 + 响应汇总)"
```

---

## Task 6: Stop 入口 `lint-fix-stop.ts`

把前面模块串起来的薄入口:读 stdin → 解析 transcript → 分组 → processGroups → buildResponse → emit。IO 边界逻辑薄,核心已在 Task 5 测过,这里加一个端到端 smoke 测验证装配。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lint-fix-stop.ts`
- Test: `plugins/hyperclaudemia/__tests__/lint-fix-stop.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/hyperclaudemia/__tests__/lint-fix-stop.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runHook } from '../scripts/lint-fix-stop.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lintfix-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function setupProject(strategy: 'eslint' | 'oxlint'): { root: string, file: string } {
  const root = join(dir, 'proj')
  mkdirSync(join(root, '.omp'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(root, '.omp', 'lint-strategy.json'), JSON.stringify({ strategy, sniffedAt: '' }))
  const file = join(root, 'a.ts')
  writeFileSync(file, 'export const a = 1\n')
  return { root, file }
}

function writeTranscript(file: string): string {
  const tp = join(dir, 't.jsonl')
  writeFileSync(tp, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] },
  }))
  return tp
}

describe('runHook (装配 smoke)', () => {
  it('no transcript -> silent (null response)', () => {
    expect(runHook({ stdin: '{}' })).toBeNull()
  })

  it('clean group -> systemMessage pass, no block', () => {
    const { file } = setupProject('oxlint')
    const tp = writeTranscript(file)
    const resp = runHook({
      stdin: JSON.stringify({ transcript_path: tp }),
      // 注入全 clean 执行器
      deps: {
        runOxfmt: () => ({ ran: true, hasRemaining: false, output: '' }),
        runOxlintFixCheck: () => ({ ran: true, hasRemaining: false, output: '' }),
        runEslintFix: () => ({ ran: true, hasRemaining: false, output: '' }),
        loadIgnorePatterns: () => [],
        filterByIgnorePatterns: (f: string[]) => f,
      },
    })
    expect(resp?.decision).toBeUndefined()
    expect(resp?.systemMessage).toContain('通过')
  })

  it('remaining -> decision=block', () => {
    const { file } = setupProject('oxlint')
    const tp = writeTranscript(file)
    const resp = runHook({
      stdin: JSON.stringify({ transcript_path: tp }),
      deps: {
        runOxfmt: () => ({ ran: true, hasRemaining: false, output: '' }),
        runOxlintFixCheck: () => ({ ran: true, hasRemaining: true, output: 'Found 1 error.' }),
        runEslintFix: () => ({ ran: true, hasRemaining: false, output: '' }),
        loadIgnorePatterns: () => [],
        filterByIgnorePatterns: (f: string[]) => f,
      },
    })
    expect(resp?.decision).toBe('block')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- lint-fix-stop`
Expected: FAIL — `Cannot find module '../scripts/lint-fix-stop.ts'`

- [ ] **Step 3: Write minimal implementation**

```ts
// plugins/hyperclaudemia/scripts/lint-fix-stop.ts
/// <reference types="bun-types" />
import type { HookResponse, OrchestratorDeps } from './lib/lint-orchestrator.ts'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildResponse, processGroups } from './lib/lint-orchestrator.ts'
import { runEslintFix, runOxfmt, runOxlintFixCheck } from './lib/lint-runners.ts'
import { loadStrategy } from './lib/lint-strategy.ts'
import { filterByIgnorePatterns, loadIgnorePatterns } from './lib/oxlint-ignore.ts'
import { extractEditedFiles, groupByProjectRoot } from './lib/transcript.ts'
import { createHookLogger } from './logger.ts'

const log = createHookLogger('Stop', 'lint-fix-stop.ts')
const OXLINT_CFG = join(homedir(), '.config', 'oxlint', 'oxlintrc.json')
const OXFMT_CFG = join(homedir(), '.config', 'oxlint', 'oxfmt.json')

interface RunHookOptions {
  stdin: string
  deps?: Partial<OrchestratorDeps>
}

/** 纯函数入口,便于测试。返回 null 表示静默(无输出)。 */
export function runHook(opts: RunHookOptions): HookResponse | null {
  let input: { transcript_path?: string, stop_hook_active?: boolean } = {}
  try { input = JSON.parse(opts.stdin) }
  catch { return null }

  const tp = input.transcript_path
  if (!tp)
    return null

  const files = extractEditedFiles(tp)
  if (files.length === 0)
    return null

  const groups = groupByProjectRoot(files)
  if (groups.size === 0)
    return null

  const deps: OrchestratorDeps = {
    loadStrategy,
    loadIgnorePatterns,
    filterByIgnorePatterns,
    runOxfmt,
    runOxlintFixCheck,
    runEslintFix,
    oxlintCfg: OXLINT_CFG,
    oxfmtCfg: OXFMT_CFG,
    ...opts.deps,
  }

  const results = processGroups(groups, deps)
  return buildResponse(results, input.stop_hook_active === true)
}

function main(): void {
  log.info('hook triggered')
  let raw = ''
  try { raw = readFileSync(0, 'utf8') }
  catch { process.exit(0) }
  if (!raw.trim())
    process.exit(0)

  const resp = runHook({ stdin: raw })
  if (resp) {
    process.stdout.write(`${JSON.stringify(resp)}\n`)
    log.done(resp.decision === 'block' ? 'blocked' : 'passed', resp.decision === 'block' ? 'warn' : 'info')
  }
  else {
    log.done('silent (no edited files / no transcript)')
  }
  process.exit(0)
}

// 仅在直接执行时跑 main;被测试 import 时不跑
if (import.meta.main)
  main()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- lint-fix-stop`
Expected: PASS

- [ ] **Step 5: Run full suite to confirm no regressions**

Run: `bun run test`
Expected: PASS（含 sample.test.ts 及前 5 个模块测试)

- [ ] **Step 6: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lint-fix-stop.ts plugins/hyperclaudemia/__tests__/lint-fix-stop.test.ts
git commit -m "feat(hyperclaudemia): 新增 lint-fix-stop Stop 入口,串起分组与编排"
```

---

## Task 7: SessionStart 预热 + hooks.json + 删旧文件

收尾:接线 hooks.json、加 SessionStart 预热入口、删除被合并的旧脚本。

**Files:**

- Create: `plugins/hyperclaudemia/scripts/lint-strategy-warmup.ts`
- Modify: `plugins/hyperclaudemia/hooks/hooks.json`
- Delete: `plugins/hyperclaudemia/scripts/oxlint-stop.ts`, `plugins/hyperclaudemia/scripts/eslint-fix-stop.ts`

- [ ] **Step 1: 写 SessionStart 预热入口**

```ts
import { loadStrategy } from './lib/lint-strategy.ts'
// plugins/hyperclaudemia/scripts/lint-strategy-warmup.ts
/// <reference types="bun-types" />
import { createHookLogger } from './logger.ts'

const log = createHookLogger('SessionStart', 'lint-strategy-warmup.ts')

function main(): void {
  try {
    const cwd = process.cwd()
    const { strategy, eslintVersion } = loadStrategy(cwd)
    log.done(`warmed strategy for ${cwd}: ${strategy}${eslintVersion ? ` (eslint@${eslintVersion})` : ''}`)
  }
  catch (e) {
    log.done(`warmup failed: ${(e as Error).message}`, 'warn')
  }
  process.exit(0)
}

main()
```

- [ ] **Step 2: 接线 hooks.json**

把 `hooks/hooks.json` 的 `SessionStart` 追加预热脚本,`Stop` 用 `lint-fix-stop.ts` 替换原 `oxlint-stop.ts` + `eslint-fix-stop.ts` 两项:

```jsonc
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh", "timeout": 30 },
          { "type": "command", "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/lint-strategy-warmup.ts", "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/token-stats-tool.ts", "timeout": 5 }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/lint-fix-stop.ts", "timeout": 60 },
          { "type": "command", "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/complexity-stop.ts", "timeout": 60 },
          { "type": "command", "command": "bun run --bun ${CLAUDE_PLUGIN_ROOT}/scripts/token-stats-stop.ts", "timeout": 10 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 3: 删除被合并的旧脚本**

```bash
git rm plugins/hyperclaudemia/scripts/oxlint-stop.ts plugins/hyperclaudemia/scripts/eslint-fix-stop.ts
```

- [ ] **Step 4: grep 确认无残留引用**

Run: `grep -rn "oxlint-stop\|eslint-fix-stop" plugins/hyperclaudemia/ --include='*.ts' --include='*.json'`
Expected: 无输出(README 等文档引用不阻塞,但应一并更新——见 Step 5)

- [ ] **Step 5: 更新 README/marketplace 描述(若提及旧脚本)**

检查 `plugins/hyperclaudemia/README.md` 与 `.claude-plugin/marketplace.json` 是否提到 `oxlint-stop`/`eslint-fix-stop`,改为 `lint-fix-stop`。`marketplace.json` 的 hyperclaudemia 描述里「oxlint 类型偷懒断言门禁 + ... + ESLint 自动修复」可改为「lint 门禁(策略嗅探 + oxfmt/eslint 自动修复 + 残留硬拦)」。

- [ ] **Step 6: 全量测试 + lint**

Run: `bun run test && bun run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugins/hyperclaudemia/scripts/lint-strategy-warmup.ts plugins/hyperclaudemia/hooks/hooks.json plugins/hyperclaudemia/README.md .claude-plugin/marketplace.json
git commit -m "feat(hyperclaudemia): 合并 lint Stop hook,接线 SessionStart 预热并移除旧脚本"
```

---

## 完成标准

- [ ] `bun run test` 全绿(6 个测试文件 + sample)
- [ ] `bun run lint` 无错
- [ ] `hooks/hooks.json` 的 Stop 数组为 3 项,SessionStart 含预热
- [ ] `scripts/oxlint-stop.ts`、`scripts/eslint-fix-stop.ts` 已删除
- [ ] 行为符合 spec:eslint≥9 项目走 `eslint --fix`,其余走 `oxfmt → oxlint --fix`,残留硬 block,工具缺失 fail-open,跨项目分组各跑各的
