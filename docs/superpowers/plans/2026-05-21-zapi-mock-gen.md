# zapi-mock-gen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a standalone skill that generates intelligent semantic mock JSON data from API definitions (ZAPI URL / JSON Schema / TypeScript types) and writes to local `autoMock/` directory.

**Architecture:** Single SKILL.md file with no external scripts. The skill instructs Claude to (1) accept input via graceful degradation, (2) generate mock data using a field-name lookup table + semantic reasoning, (3) handle response wrapping based on user preference, (4) write to `autoMock/` directory, (5) manage `.gitignore` and `.mock-config.json`.

**Tech Stack:** SKILL.md (Markdown with YAML frontmatter), references `zapi-to-ts/scripts/zapi_fetch.py` for ZAPI mode.

---

### Task 1: Create skills/zapi-mock-gen/SKILL.md

**Files:**

- Create: `skills/zapi-mock-gen/SKILL.md`

- [ ] **Step 1: Create the skill file**

Write `skills/zapi-mock-gen/SKILL.md` with the following complete content:

```markdown
---
name: zapi-mock-gen
description: 根据 ZAPI URL / JSON Schema / TypeScript 类型生成智能语义 Mock JSON 数据并写入本地 autoMock/ 目录。当用户提供接口定义并要求 mock，或提到"mock 数据"、"生成 mock"、"模拟接口"时触发。
metadata:
  type: skill
---

# zapi-mock-gen: 智能语义 Mock 数据生成

根据接口定义自动生成 Mock JSON 数据并写入 `autoMock/` 目录。

## 使用场景

- **前端并行开发**：后端接口未就绪时，根据接口定义生成 mock 数据先行开发
- 支持三种输入源的降级：ZAPI URL → JSON Schema → TypeScript 类型

## 流程概览
```

用户输入 (ZAPI URL / JSON Schema / TS 类型)
↓
解析接口字段 + 类型 + 注释
↓
查字段名→Mock 值速查表 + 语义推理
↓
处理通用返回值包装
↓
写入 autoMock/{路径}.json + 更新 .gitignore

````

## 输入检测（降级链路）

按顺序检测用户输入类型，使用第一个匹配的模式：

### 1. ZAPI URL 模式

输入匹配 `zapi.zhuanspirit.com` URL 时：

1. 从输入中提取 `interface-id`（URL 中的数字 ID）
2. 调用 zapi-to-ts 的 fetch 脚本：
   ```bash
   python3 <skills_dir>/zapi-to-ts/scripts/zapi_fetch.py --token <token> --interface-id <id>
````

3. 从返回值中提取 `res_body`（响应体 JSON Schema）
4. 若 Schema 为空，提示用户检查接口是否已发布或有无返回值定义
5. ZAPI 返回的 `res_body` 只含 `respData` 内部结构，自动包装外层（见下方"通用返回值包装"）

### 2. JSON Schema 模式

输入包含 `"type"`、`"properties"`、`"$schema"` 等特征时：

1. 解析 JSON Schema 提取所有字段：
   - 字段名 + 类型 + `description` 注释
   - 嵌套对象和数组结构
   - `enum` 枚举值
2. 基于提取的结构生成 mock

### 3. TypeScript 类型模式

输入含有 `interface`、`type`、`:string`、`:number` 等 TS 语法时：

- 基本类型：`string` → mock string，`number` → mock number，`boolean` → mock boolean
- 复杂类型：`interface`/`type` → 嵌套对象
- 数组：`T[]` / `Array<T>` → 长度为 1 的数组
- 联合类型：`'a' | 'b' | 'c'` → 提取为枚举
- 泛型：`ApiResult<T>` → 提取 `T`
- 若类型过于复杂（条件类型、交叉类型等），提示用户降级到 JSON Schema

### 4. 无法识别

询问用户确认输入类型。

## 字段名→Mock 值速查表

按表中顺序优先匹配字段名，未命中的字段根据语义 + `description` 注释推理。

| 字段名模式                                                   | 生成值                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| `id`、`ID`、`userId`、`orderId` 等 ID 字段（数值型）         | 自增 ID，从 1 开始                                            |
| `name`、`userName`、`nickname`、`realName`                   | "张三"、"李四"、"王五"轮换                                    |
| `phone`、`mobile`、`tel`、`手机号`                           | "13800138000"                                                 |
| `email`、`mail`                                              | "user@example.com"                                            |
| `address`、`addr`                                            | "北京市朝阳区..."                                             |
| `avatar`、`img`、`image`、`pic`、`cover`、`photo`            | `https://picsum.photos/seed/{字段名}/{w}/{h}`（w/h 默认 200） |
| `status`、`state`（枚举类型）                                | 从 enum 中取第一项                                            |
| `type`（枚举类型）                                           | 从 enum 中取第一项                                            |
| `createTime`、`updateTime`、`date`、`时间`                   | 当前时间的 ISO 字符串                                         |
| `description`、`desc`、`remark`、`备注`                      | "这是mock数据"                                                |
| `price`、`amount`、`total`、`money`、`fee`、`cost`、`budget` | 随机整数 1000~999900（以分为单位）                            |
| `count`、`num`、`quantity`、`number`                         | 随机整数 1~100                                                |
| `url`、`link`                                                | `https://example.com/{字段名}`                                |
| `page`、`pageNum`                                            | 1                                                             |
| `pageSize`                                                   | 20                                                            |
| `total`（响应层分页）                                        | 数组长度                                                      |
| 布尔类型（`is*`、`has*`、`enable*`）                         | `true`                                                        |
| 未知字段名                                                   | string→"mock\_{字段名}"，number→0，boolean→false，array→[]    |

## 通用返回值包装

**ZAPI 模式**：`res_body` 只包含 `respData` 内部结构，自动包装：

```json
{
  "respCode": 0,
  "respMsg": "success",
  "respData": { ... }
}
```

**JSON Schema / TS 类型模式（非 ZAPI）**：

1. **检测**：检查 Schema 顶层是否有 `code` / `respCode` / `errMsg` / `error` 等通用返回字段
   - **有** → 直接输出，不额外包装
   - **没有** → 首次询问用户："是否需要包裹通用返回值结构？可用字段：respData, respCode, errMsg, error"
   - 用户选择后，记入 `autoMock/.mock-config.json`，后续不再询问

## 用户偏好存储

`.mock-config.json` 位于 `autoMock/` 目录下：

```json
{
  "wrapResponse": true,
  "wrapFields": {
    "dataKey": "respData",
    "codeKey": "respCode",
    "msgKey": "errMsg",
    "errorKey": "error"
  },
  "imageBaseUrl": "https://picsum.photos"
}
```

- 首次生成 `autoMock/` 目录时创建
- 用户选择包装策略后更新
- 后续生成时读取并沿用

## 输出文件结构

```
autoMock/
  ├── .mock-config.json
  └── api/
      ├── user/
      │   ├── login.post.json
      │   └── info.get.json
      └── order/
          └── list.get.json
```

- 文件命名规则：`{路径最后一段}.{method}.json`
- 路径从 ZAPI URL 的 `path` 字段提取；非 ZAPI 模式由用户指定或按第 2 段路径
- 列表默认只生成 **1 条** mock 数据（用户可在 prompt 中指定数量）
- 写入后检查 `.gitignore`，若没有 `autoMock/` 则追加一行

## 边界情况

| 场景                          | 处理方式                                           |
| ----------------------------- | -------------------------------------------------- |
| ZAPI URL 无效或不可达         | 报错提示检查 URL                                   |
| 接口 Schema 为空              | 提示"接口未发布或无返回值定义"，建议换 JSON Schema |
| JSON Schema 不合法            | 提示解析错误位置                                   |
| TS 类型过于复杂               | 提示降级到 JSON Schema                             |
| `autoMock/` 已存在            | 追加新文件，不覆盖                                 |
| 同名文件已存在                | 询问是否覆盖                                       |
| `.gitignore` 已含 `autoMock/` | 跳过                                               |

````

- [ ] **Step 2: Run lint check**

```bash
cd /Users/jacobzha/Documents/workspace/jacob-open-source/jacob-skills-collection && pnpm lint:fix
````

Expected: Should pass with no errors (SKILL.md is Markdown, lint will not complain).

- [ ] **Step 3: Commit**

```bash
cd /Users/jacobzha/Documents/workspace/jacob-open-source/jacob-skills-collection && git add skills/zapi-mock-gen/SKILL.md && git commit -m "$(cat <<'EOF'
feat: add zapi-mock-gen skill for intelligent mock JSON generation

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com
EOF
)"
```

- [ ] **Step 4: Verify** — check that `skills/zapi-mock-gen/SKILL.md` exists and has valid content
