# zapi-mock-gen: 智能语义 Mock 数据生成 Skill

## 概述

独立 skill，用于根据接口定义自动生成智能语义的 Mock JSON 数据并写入本地文件。不负责 Whistle 注入或 API 类型生成——这两个分别由 `whistle-rules-inject` 和 `zapi-to-ts` 处理，后续通过串联 skill 组合。

## 名称

- Skill 名称：`zapi-mock-gen`
- 文件路径：`skills/zapi-mock-gen/`

## 整体流程

```
用户输入
  ├── ZAPI URL → 复用 zapi-to-ts/scripts/zapi_fetch.py 拉取 res_body Schema
  ├── JSON Schema → 直接使用
  └── TypeScript 类型 → Claude 解析为内部 Schema 表示
        ↓
  读取字段名 + 类型 + 描述/注释
        ↓
  查字段名→Mock 值速查表 + 语义推理 → 生成 mock JSON
        ↓
  写入 autoMock/{接口路径}.json
  检查/更新 .gitignore
```

## 触发条件

- 用户提供 `zapi.zhuanspirit.com` 的接口 URL 并要求 mock
- 用户直接给 JSON Schema 要求生成 mock 数据
- 用户给 TypeScript 类型要求生成 mock 数据
- 关键词："mock 数据"、"生成 mock"、"模拟接口"

## 输入降级链路

三种输入按优先级自动检测：

1. **ZAPI URL 模式**：命中 `zapi.zhuanspirit.com` URL
   - 内部调用 `zapi-to-ts/scripts/zapi_fetch.py`，提取 `res_body`（JSON Schema）
   - Schema 为空时提示用户检查接口状态

2. **JSON Schema 模式**：包含 `"type"`、`"properties"`、`"$schema"` 等特征
   - 直接读取 `properties`/`items`、字段名 + 类型 + `description` 注释

3. **TS 类型模式**：含有 TypeScript 语法（`interface`/`type`/`:string`/`:number` 等）
   - Claude 解析为内部 Schema，支持：
     - 基本类型：`string`、`number`、`boolean`
     - 复杂类型：`interface`、`type`、嵌套对象
     - 数组：`T[]`、`Array<T>`
     - 联合类型：`'a' | 'b' | 'c'` → 枚举
     - 泛型：`ApiResult<T>` → 提取 `T`

4. **都无法识别**：询问用户确认输入类型

## 字段名→Mock 值速查表

按字段名模式匹配，优先命中速查表，未命中的字段根据语义 + `description` 注释推理。

| 字段名模式 | 生成值 |
|-----------|--------|
| `id`、`ID`、`userId`、`orderId` 等 ID 字段（数值型） | 自增 ID，从 1 开始 |
| `name`、`userName`、`nickname`、`realName` | "张三"、"李四"、"王五"轮换 |
| `phone`、`mobile`、`tel`、`手机号` | "13800138000" |
| `email`、`mail` | "user@example.com" |
| `address`、`addr` | "北京市朝阳区..." |
| `avatar`、`img`、`image`、`pic`、`cover`、`photo` | `https://picsum.photos/seed/{字段名}/{w}/{h}` |
| `status`、`state`（枚举类型） | 从 enum 中取第一项作为默认 |
| `type`（枚举类型） | 同上 |
| `createTime`、`updateTime`、`date`、`时间` | 当前时间的 ISO 字符串 |
| `description`、`desc`、`remark`、`备注` | "这是mock数据" |
| `price`、`amount`、`total`、`money`、`fee`、`cost`、`budget` | 随机整数 1000~999900（以分为单位） |
| `count`、`num`、`quantity`、`number` | 随机整数 1~100 |
| `url`、`link` | `https://example.com/{字段名}` |
| `page`、`pageNum` | 1 |
| `pageSize` | 20 |
| `total`（响应层） | 列表长度 |
| 布尔类型（`is*`、`has*`、`enable*`） | `true` |
| 未知字段名 | 按类型生成：string→"mock_{字段名}"，number→0，boolean→false，array→[] |

## 通用返回值包装策略

仅对非 ZAPI 模式（JSON Schema / TS 类型）生效：

1. **自动检测**：检查 Schema 顶层是否已有 `code` / `respCode` / `errMsg` / `error` 等通用返回值字段
   - **有** → 直接输出，不额外包装
   - **没有** → 首次询问用户："是否需要包裹通用返回值结构？可用字段：respData, respCode, errMsg, error"
   - 用户做出选择后，记入 `autoMock/.mock-config.json`，后续不再询问

2. **ZAPI 模式**：自动套回 `respCode: 0` + `respMsg: "success"` 外层（因 ZAPI 的 `res_body` 只包含 `respData` 内部结构）

## 用户偏好存储

`.mock-config.json` 位于 `autoMock/` 目录下，skill 生成/读取：

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

## 输出文件结构

```
autoMock/
  ├── .mock-config.json
  └── api/
      ├── user/
      │   ├── login.post.json          # POST /api/user/login
      │   └── info.get.json            # GET /api/user/info
      └── order/
          └── list.get.json            # GET /api/order/list
```

- 文件命名规则：`{路径最后一段}.{method}.json`
- 列表默认只生成 1 条 mock 数据，用户可通过 prompt 指定数量
- 写入后检查 `.gitignore`，若没有 `autoMock/` 则追加

## 边界情况与错误处理

| 场景 | 处理方式 |
|------|---------|
| ZAPI URL 无效或不能访问 | 报错提示，建议检查 URL |
| 接口返回 Schema 为空 | 提示"接口可能未发布或没有返回值定义"，建议切换到 JSON Schema 输入 |
| JSON Schema 不合法 | 尝试解析后提示具体错误位置 |
| TS 类型过于复杂（条件类型/交叉类型） | 提示"过于复杂，建议提供 JSON Schema"降级 |
| `autoMock/` 目录已存在 | 不覆盖，追加新文件 |
| 同名文件已存在 | 询问是否覆盖 |
| `.gitignore` 已含 `autoMock/` | 跳过，不重复写入 |

## 与现有 skill 的关系

```
zapi-to-ts (拉取 ZAPI 接口定义)
     ↓
zapi-mock-gen ← 本 skill，独立使用
     ↓
whistle-rules-inject (注入 Whistle 规则)

后续: 串联 skill（zapi-to-ts → zapi-mock-gen → whistle-rules-inject）
```

- zapi-mock-gen 不依赖其他 skill——它是一个独立工具
- 但在 ZAPI 模式下会复用 `zapi-to-ts/scripts/zapi_fetch.py` 脚本（通过路径引用）
- 后续的串联 skill 负责编排完整链路
