# VisibleFunction 后端接口与数据收集手册

本文记录 `agent/p0-stabilization` 当前工作区中的后端实现。Web 协议版本为 `3`。

## 1. 数据分类

### 1.1 运行时原始记录

后端运行时输出两种原始记录：

| `TraceRecord.type` | 含义 | 主要来源 |
| --- | --- | --- |
| `COMMAND` | Minecraft 命令执行记录 | 命令执行任务进入时采集 |
| `EVENT` | 命令结果或实体生成事件 | Scoreboard、Storage、Kill、Teleport、Give、Effect、Tag 和实体加载回调 |

`FUNCTION` 和 `TICK` 不是 `TraceRecord.type` 的取值：

- `FUNCTION` 是对带有 `function`、`function_call_id` 上下文的 `COMMAND` 或 `EVENT` 记录所做的分组投影。
- `TICK` 来自服务器 tick、记录中的 `tick` 字段，以及数据包静态 TICK 函数索引。
- Advancement 和 Enchantment Trigger 以命令上下文字段存在，不生成独立记录类型。

### 1.2 派生数据

后端在原始记录之外生成以下数据：

| 数据 | 来源 | 用途 |
| --- | --- | --- |
| Function 分组 | `basicFields.function` 和 `function_call_id` | 将同一次函数调用内的命令与事件归组 |
| Tick Filter 分组 | 数据包静态 TICK 函数索引和记录上下文 | 标识静态 TICK 函数中的 FUNCTION、COMMAND、EVENT |
| Grouped 数据 | 当前选定的 `TraceRecord` 集合 | 按命令类型、事件动作和函数 ID 汇总 |
| Datapack Analysis | 数据包函数、标签和命令静态扫描 | 返回函数、调用边、变量和图关系 |
| Datapack Trigger Analysis | Advancement 与 Enchantment 静态扫描 | 返回触发器到函数的关系 |
| Recording | 原始记录和 Tick Filter footer | 保存及回放运行时数据 |

## 2. 数据采集流程

运行时数据流如下：

```text
Minecraft mixin / Fabric event hook
  -> VisibleFunctionEventText
  -> VisibleFunction.emitEvent(...)
  -> 添加服务器 tick 与上下文字段
  -> Tick Filter 分类
  -> 窗口 / 日志 / 聊天 / Web Export / Recording
```

`VisibleFunction.withTick` 使用服务器 overworld 的 game time，在基础字段和详细字段中写入 `tick`。记录的 `timestampMillis` 使用系统墙钟毫秒时间。

记录是否发送到各输出目标由运行时设置决定。当前默认值为：

| 设置 | 默认值 |
| --- | --- |
| VisibleFunction enabled | `true` |
| 输出目标 | 游戏内窗口 |
| Web Export | `false` |
| Web Export 端口 | `17654` |

Recording 激活时，即使 Web Export 未启动，记录仍会进入录制路径。

## 3. `TraceRecord` 数据结构

HTTP、SSE 和 protocol v3 Recording 中使用相同的记录结构：

```json
{
  "id": 1,
  "type": "COMMAND",
  "commandType": "execute",
  "eventAction": "",
  "groups": ["commands", "functions"],
  "subject": "...",
  "summary": "...",
  "timestampMillis": 1783670000000,
  "sessionId": 123456789,
  "tickFilterGroupIds": [],
  "capturedTickFilterGroupIds": [],
  "commandContext": {
    "command": "execute ...",
    "commandId": "123",
    "source": "function",
    "function": "example:main",
    "functionCallId": "456",
    "triggerType": "none",
    "triggerId": "none",
    "triggerFunction": "none"
  },
  "basicFields": {},
  "detailedFields": {}
}
```

### 3.1 顶层字段

| 字段 | 类型 | 当前含义 |
| --- | --- | --- |
| `id` | number | 当前 Export Server 或 Recording 内递增的记录 ID |
| `type` | string | `COMMAND` 或 `EVENT` |
| `commandType` | string | 命令解析器识别的命令类别；未识别时为 `none` |
| `eventAction` | string | Export JSON 从 `basicFields.action` 读取；不存在时回退到摘要 |
| `groups` | string[] | 包含 `commands` 或 `events`；存在函数上下文时同时包含 `functions` |
| `subject` | string | 格式化器生成的记录主体 |
| `summary` | string | 格式化器生成的摘要 |
| `timestampMillis` | number | 记录创建时的系统墙钟毫秒时间 |
| `sessionId` | number | Export Server 实例的会话 ID |
| `tickFilterGroupIds` | string[] | 记录所属的全部 Tick Filter canonical group |
| `capturedTickFilterGroupIds` | string[] | 记录发布时已经处于 captured 状态的 group |
| `commandContext` | object | 命令、函数和触发器上下文 |
| `basicFields` | object | 基础字段，值均为字符串 |
| `detailedFields` | object | 详细字段，值均为字符串 |

当前 EVENT 格式化器将事件动作写入 `basicFields.event_action`。Export JSON 的顶层 `eventAction`、`grouped.eventsByAction` 和 Tick Filter EVENT key 从 `basicFields.action` 读取。前端的事件动作读取顺序为：

1. `basicFields.event_action`
2. `basicFields.action`
3. 顶层 `eventAction`

### 3.2 `commandContext`

| 字段 | 含义 |
| --- | --- |
| `command` | 当前执行的原始命令文本 |
| `commandId` | 单次命令执行的关联 ID |
| `source` | 命令来源 |
| `function` | 当前函数资源 ID；无函数上下文时为 `none` |
| `functionCallId` | 当前函数调用帧 ID；无函数上下文时为 `none` |
| `triggerType` | `advancement`、`enchantment` 或 `none` |
| `triggerId` | Advancement 或 Enchantment 资源 ID |
| `triggerFunction` | 由 Trigger 调用的函数资源 ID |

`source` 当前使用以下字符串：

- `player`
- `server`
- `command_block`
- `function`
- `tick function`
- `unknown`

EVENT 可以复用触发它的 COMMAND 的 `commandId`。同一函数调用内的记录复用 `functionCallId`。当前数据结构不包含函数进入、函数退出或函数耗时记录；没有产生命令或事件的函数调用不会生成独立 `TraceRecord`。

## 4. COMMAND 采集

### 4.1 采集时机

`ExecuteCommandMixin` 在命令执行任务进入时建立命令上下文，在任务返回时弹出上下文。函数调用帧 ID 由函数调用 mixin 分配。

COMMAND 的基础上下文包含：

- `command_id`
- `source`
- `function`
- `function_call_id`
- `position`

详细上下文还包含：

- `dimension`
- `rotation`
- `executor`
- `executor_entity`
- 可选的 `nested_command`
- 可选的 Trigger 字段

### 4.2 命令解释类型

当前存在专用解释器的命令类型为：

| 命令 | `commandType` |
| --- | --- |
| `execute` | `execute` |
| `give` | `give` |
| `effect` | `effect` |
| `kill` | `kill` |
| `tp` / `teleport` | `teleport` |
| `scoreboard` | `scoreboard` |
| `data` | `data` |

其他命令仍生成 COMMAND 记录，顶层 `commandType` 为 `none`。Grouped 数据在缺少 `command_type` 字段时使用 `unknown` 作为 `commandsByType` 的 key。

`CommandResultEventFormatter.format` 当前返回空结果，因此不存在覆盖全部命令的通用命令结果 EVENT。语义 EVENT 由各专用 hook 生成。

## 5. EVENT 采集

### 5.1 Scoreboard

当前生成以下 `event_action`：

- `scoreboard_objective_created`
- `scoreboard_objective_removed`
- `scoreboard_objective_modified`
- `scoreboard_score_set`
- `scoreboard_score_added`
- `scoreboard_score_removed`
- `scoreboard_score_reset`
- `scoreboard_operation`
- `scoreboard_display_changed`

### 5.2 Storage

Storage EVENT 针对 `StorageDataAccessor` 生成，不覆盖 Entity NBT 和 Block NBT 的全部数据操作。

当前生成以下 `event_action`：

- `storage_read`
- `storage_merged`
- `storage_modified`
- `storage_removed`

`execute store result storage` 和 `execute store success storage` 的写入结果也生成 `storage_modified`。Storage 数据预览最大长度为 220 个字符。

### 5.3 命令结果

| 命令或操作 | `event_action` |
| --- | --- |
| `kill` | `entity_killed` |
| `tp` / `teleport` | `entity_teleported` |
| `give` | `item_given` |
| `effect give` | `effect_applied` |
| `effect clear` | `effect_cleared` |
| `tag add` | `tag_added` |
| `tag remove` | `tag_removed` |
| `tag list` | `tag_listed` |
| Tag 操作回退 | `tag_updated` |

### 5.4 实体生成

Fabric 实体加载回调用于生成实体生成 EVENT。磁盘加载和 `LOAD` 原因不生成该 EVENT。

当前处理的生成原因包括：

- 命令和 mob summoned
- natural
- spawner 和 trial spawner
- spawn item use 和 bucket
- structure 和 chunk generation
- breeding
- dimension travel
- 其他 Fabric spawn reason

实体生成记录包含 `spawn_reason`、实体位置和可选生命值。`subject` 使用实体类型资源 ID。当前实体生成格式化器不写入 `event_type` 或 `event_action`。命令上下文只在命令或 mob summoned 生成原因下附加。

### 5.5 当前未注册语义 EVENT hook 的操作

以下操作在作为命令执行时仍生成 COMMAND；当前没有对应的专用语义 EVENT hook：

- attribute
- bossbar
- gamerule
- schedule
- sound 和 particle
- loot
- 通用 damage
- 通用 inventory 变化
- 通用实体移动
- 非命令触发的实体死亡
- 非命令触发的 effect 变化
- Block NBT 和 Entity NBT 的通用变更
- 函数进入、退出和耗时

## 6. Trigger 上下文

当前 Trigger 索引和运行时上下文覆盖：

- Advancement reward function
- Enchantment effect 中的 `run_function`

运行时进入对应函数时，COMMAND 和 EVENT 可以带有：

- `trigger_type`
- `trigger_id`
- `trigger_function`
- 详细字段中的 actor、entity、position、dimension

Trigger 不生成独立 `TraceRecord`。

## 7. Tick Filter

### 7.1 静态 TICK 集合

当前 Tick Filter 只处理数据包静态 TICK 函数：

1. 从 `minecraft:tick` function tag 的根函数开始。
2. 沿函数正文中的顶层直接 `function <id>` 调用传播。
3. 沿函数正文中的顶层直接 `function #<tag>` 调用传播并展开标签。
4. `execute ... run function` 不构成静态 TICK 传播边。
5. 非静态 TICK 记录不生成 Tick Filter membership、bucket 或 captured transition。

静态 TICK 记录第一次出现时即进入 captured 状态。

### 7.2 分组结构

Tick Filter group 类型包括：

- `FUNCTION`
- `COMMAND`
- `EVENT`

静态函数内的 COMMAND 记录同时属于 FUNCTION 父组和 COMMAND 子组；EVENT 记录同时属于 FUNCTION 父组和 EVENT 子组。子组通过 `parentGroupId` 指向函数父组。

`groupId` 是 canonical group key 的 SHA-256 前 16 字节十六进制表示，共 128 bit。实时分类、查询重算和 Recording 使用同一生成方式。

### 7.3 Bucket 结构

```json
{
  "groupId": "0123456789abcdef0123456789abcdef",
  "key": "...",
  "type": "FUNCTION",
  "displayName": "example:main",
  "functionId": "example:main",
  "parentGroupId": null,
  "firstSeenTick": 100,
  "lastSeenTick": 120,
  "startMillis": 1783670000000,
  "endMillis": 1783670001000,
  "totalCount": 21,
  "countLastSecond": 20,
  "sourceSummary": "tick function",
  "reason": "tick function",
  "active": true,
  "recordIds": [],
  "commandIds": [],
  "sampleRecords": []
}
```

`countLastSecond` 使用最近 20 tick 的窗口。最近窗口内计数大于零时 `active` 为 `true`。

Live Tick Filter 当前最多保留：

- 4096 个 bucket
- 每个 bucket 8192 个 record ID
- 每个 bucket 6 条 sample record

Recording 使用相同引擎结构，record ID 保存上限为 8，sample record 上限为 0。

## 8. Web Export Server

### 8.1 启动与网络范围

Web Export 通过游戏内命令启动：

```text
/visiblefunction export start
```

服务器绑定 `127.0.0.1`，当前只处理 GET 请求，不包含认证流程。HTTP 响应包含 `Access-Control-Allow-Origin: *`。

### 8.2 路由列表

| 方法 | 路径 | 返回内容 |
| --- | --- | --- |
| GET | `/` | 内嵌 Web 前端 |
| GET | `/index.html` | 内嵌 Web 前端 |
| GET | `/health` | 协议、会话、tick 和队列状态 |
| GET | `/api/v1/records` | 原始记录列表 |
| GET | `/api/v1/grouped` | 当前记录集合的分组结果 |
| GET | `/api/v1/tick-filter` | Live Tick Filter 或记录切片重算结果 |
| GET | `/api/v1/datapack-analysis` | 数据包函数和调用图分析 |
| GET | `/api/v1/datapack-triggers` | Advancement 和 Enchantment Trigger 分析 |
| GET | `/api/v1/recording/status` | 录制状态 |
| GET | `/api/v1/recordings` | 已完成录制列表 |
| GET | `/api/v1/recordings/latest` | 最新录制文件 |
| GET | `/api/v1/recordings/{id}` | 指定录制文件 |
| GET | `/api/v1/stream` | Server-Sent Events 流 |

### 8.3 查询参数

`/api/v1/records`、`/api/v1/grouped` 和 `/api/v1/tick-filter` 接受以下参数：

| 参数 | 默认值 | 行为 |
| --- | --- | --- |
| `after` | `0` | 返回 ID 严格大于该值的记录 |
| `limit` | `500` | 返回数量，限制在 1 到 5000 |
| `tail` | `false` | 当 `tail=true` 且 `after<=0` 时，返回最后 `limit` 条 |

`/api/v1/tick-filter` 在没有非空 query string 时返回 Live Tick Filter engine 的全量结果；存在非空 query string 时，从查询选中的记录切片重新计算。

## 9. HTTP 响应

### 9.1 `GET /health`

```json
{
  "protocolVersion": 3,
  "running": true,
  "port": 17654,
  "records": 100,
  "sessionId": 123456789,
  "currentTick": 1448633,
  "oldestRecordId": 1,
  "latestRecordId": 100,
  "droppedStreamRecords": 0,
  "slowClientDisconnects": 0
}
```

Export Server 重启时，内存记录被清空，下一条记录 ID 从 1 开始，并生成新的 `sessionId`。

### 9.2 `GET /api/v1/records`

```json
{
  "records": [
    { "id": 1, "type": "COMMAND" }
  ]
}
```

数组元素使用完整 `TraceRecord` 结构。

### 9.3 `GET /api/v1/grouped`

```json
{
  "counts": {
    "commands": 0,
    "events": 0,
    "functions": 0,
    "other": 0
  },
  "commands": [],
  "events": [],
  "functions": [],
  "other": [],
  "commandsByType": {},
  "eventsByAction": {},
  "functionsById": {},
  "tickFilter": []
}
```

`functions` 是包含函数上下文的 COMMAND 和 EVENT 记录投影。同一条记录可以同时存在于 `commands`/`events` 与 `functions` 中。`counts.functions` 表示带函数上下文的记录数量，不表示函数调用次数。

### 9.4 `GET /api/v1/tick-filter`

```json
{
  "tickFilter": []
}
```

数组元素使用 Tick Filter bucket 结构。

## 10. SSE 协议

`GET /api/v1/stream` 使用 `text/event-stream`。当前事件如下：

| SSE event | data | 发送时机 |
| --- | --- | --- |
| `hello` | 完整 health JSON | 客户端连接后一次 |
| `tick` | `{"sessionId":...,"currentTick":...}` | 每 5 个服务器 tick |
| `tick-filter` | `{"tickFilter":[...]}` | 静态 Tick Filter group 第一次 captured 时 |
| `record` | 单个 `TraceRecord` | 批次只有 1 条时 |
| `records` | `{"records":[...]}` | 批次多于 1 条时 |
| keepalive comment | SSE 注释行 | 每 15 秒 |

单次 record batch 最大为 512 条。Tick heartbeat 约每 250 ms 发送一次。`tick` 由服务器 tick 线程触发，记录批次由广播线程发送，因此两类事件之间不定义全局到达顺序。`tick-filter` transition 在广播线程中先于包含对应记录的 record batch 发送。

## 11. 内存队列与 SSE 客户端

| 项目 | 当前值和行为 |
| --- | --- |
| 内存记录目标量 | 20,000 条 |
| 内存裁剪 | 超出量大于 1,000 时删除超出部分 |
| 待广播记录队列 | 8,192 条 |
| 待广播队列溢出 | 删除最旧记录并增加 `droppedStreamRecords` |
| 单客户端 SSE 队列 | 256 个消息 |
| 单客户端队列溢出 | 断开该客户端并增加 `slowClientDisconnects` |
| 单次广播批次 | 最多 512 条记录 |

## 12. Datapack Analysis

`GET /api/v1/datapack-analysis` 返回数据包函数静态分析结果，主要字段包括：

- `analysis`
- `functions`
- `edges`
- 可选命令明细
- `variables`
- 可选 `graph`
- `tags`

函数数据包含 tick root、tick function、原始命令、effective command、execute clauses 和 selector 等静态信息。分析在服务器启动和数据包 reload 时重建。

完整字段结构见 [Datapack Analysis API](datapack-analysis-api.md)。

## 13. Datapack Trigger Analysis

`GET /api/v1/datapack-triggers` 返回以下静态关系：

- Advancement reward function
- Enchantment effect 中的 `run_function`
- Trigger 与函数之间的关系

主要字段包括：

- `analysis`
- `advancements`
- `enchantments`
- `triggers`
- `functions`

分析在服务器启动和数据包 reload 时重建。

完整字段结构见 [Datapack Trigger API](datapack-trigger-api.md)。

## 14. Recording

### 14.1 控制方式

Recording 通过游戏内命令控制：

```text
/visiblefunction recording start
/visiblefunction recording stop
/visiblefunction recording toggle
/visiblefunction recording status
```

当前 HTTP API 提供状态和文件读取，不提供启动、停止或删除录制的写接口。

录制目录为运行目录下的 `visiblefunction-recordings`。录制 ID 由时间戳、毫秒和随机后缀组成。

### 14.2 protocol v3 文件结构

```json
{
  "journal": {
    "format": "records-v3",
    "id": "20260710-143152-378-c5cb2b64",
    "startedAtMillis": 1783670000000
  },
  "records": [],
  "data": {
    "counts": {
      "commands": 0,
      "events": 0,
      "functions": 0,
      "other": 0
    },
    "commands": [],
    "events": [],
    "functions": [],
    "other": [],
    "commandsByType": {},
    "eventsByAction": {},
    "functionsById": {},
    "tickFilter": []
  },
  "recording": {
    "id": "20260710-143152-378-c5cb2b64",
    "startedAtMillis": 1783670000000,
    "endedAtMillis": 1783670060000,
    "durationMillis": 60000,
    "file": "...json",
    "records": 100,
    "format": "records-v3",
    "recovered": false,
    "stopReason": "manual"
  }
}
```

protocol v3 中，顶层 `records` 是录制原始记录集合。`data.tickFilter` 保存录制期间生成的静态 Tick Filter bucket。当前 footer 中的 `data.commands`、`data.events`、`data.functions` 和对应 map 为空；`data.counts.other` 使用录制记录总数。

Recording 开始时，录制内部的记录 ID 从 1 开始。记录中的 `sessionId` 取自 Export Server 实例；Export Server 未启动时该值可以为 0。

### 14.3 状态接口

`GET /api/v1/recording/status` 返回以下字段，当前均序列化为字符串：

- `active`
- `activeId`
- `activeRecords`
- `activeBytes`
- `directory`
- `activeFile`
- `completed`
- `latest`
- `lastStopReason`
- `maxBytes`
- `maxDurationMillis`
- `maxFiles`
- `maxTotalBytes`
- `minFreeBytes`

`GET /api/v1/recordings` 的列表元数据使用对应的 number、boolean 和 string JSON 类型，字段包括：

- `id`
- `startedAtMillis`
- `endedAtMillis`
- `durationMillis`
- `file`
- `records`
- `sizeBytes`
- `recovered`
- `stopReason`

`/api/v1/recordings/latest` 和 `/api/v1/recordings/{id}` 返回录制文件内容。

### 14.4 写入与保留参数

| 项目 | 当前默认值 |
| --- | --- |
| flush 间隔 | 64 条记录 |
| 磁盘空间检查间隔 | 每写入 1 MiB |
| footer 预留空间 | 16 MiB |
| 单文件最大大小 | 1 GiB |
| 单次录制最大时长 | 2 小时 |
| 最大文件数量 | 100 |
| 录制目录最大总量 | 10 GiB |
| 最小剩余磁盘空间 | 1 GiB |

这些限制可通过对应 JVM property 配置。启动时会处理未完整结束的 records-v2 和 records-v3 文件，并在元数据中标记 `recovered`。

## 15. 会话与关联 ID

| ID | 生命周期 | 作用 |
| --- | --- | --- |
| `sessionId` | Export Server 实例 | 区分服务器重启前后的实时数据 |
| `TraceRecord.id` | Export Server 或单个 Recording | 排序、增量查询和 SSE 去重 |
| `commandId` | 单次命令执行上下文 | 关联 COMMAND 与由该命令产生的 EVENT |
| `functionCallId` | 单次函数调用帧 | 关联同一次函数调用中的记录 |
| `tickFilterGroupId` | canonical group key | 关联静态 Tick Filter 父子组和记录 membership |

最近命令上下文按服务器保存，容量为 32，最长保留 5 tick，用于将稍后生成的结果 EVENT 与命令上下文关联。
