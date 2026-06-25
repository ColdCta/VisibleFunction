# VisibleFunction WebView Frontend Manual

## 0. Goal

Build a dark, dense WebView debugger for VisibleFunction trace data. The target UI should follow the attached reference image:

- top app bar with recording state and actions
- left inspector/sidebar for session, filters, search, quick views
- central timeline grid with Tick/Event/Function/Commands lanes
- right selected-item details panel
- bottom minimap/overview timeline

The in-game GUI should stay lightweight. The WebView is the main analysis surface for datapack authors.

Frontend owner should consume the local HTTP API only. Do not modify Minecraft/Fabric backend code unless explicitly asked.

## 1. Backend Base URL

Default:

```text
http://127.0.0.1:17654
```

The user starts the export server in Minecraft:

```mcfunction
/visiblefunction export start
```

The export stream continues until:

```mcfunction
/visiblefunction export stop
```

Useful commands in Minecraft:

```mcfunction
/visiblefunction export status
/visiblefunction export port <1024-65535>
/visiblefunction recording start
/visiblefunction recording stop
/visiblefunction recording toggle
/visiblefunction recording status
```

Default in-game recording hotkey:

```text
]
```

Press once to start recording. Press again to stop. A completed recording is written to:

```text
visiblefunction-recordings/visiblefunction-recording-<id>.json
```

Important limitation for the current backend: HTTP endpoints are read-only GET endpoints. The frontend can display recording state and load recordings, but should not assume it can start or stop recording through HTTP yet.

## 2. Current API

### Health

```http
GET /health
```

Example:

```json
{
  "running": true,
  "port": 17654,
  "records": 128
}
```

Use this for connection state, record count, and disconnected handling.

### Flat Records

```http
GET /api/v1/records
GET /api/v1/records?after=10&limit=500
```

Response:

```json
{
  "records": []
}
```

Use this for initial backfill and incremental polling fallback.

### Grouped Records

```http
GET /api/v1/grouped
GET /api/v1/grouped?after=10&limit=500
```

Response:

```json
{
  "counts": {
    "commands": 11,
    "events": 6,
    "functions": 7,
    "other": 0
  },
  "commands": [],
  "events": [],
  "functions": [],
  "other": [],
  "commandsByType": {},
  "eventsByAction": {},
  "functionsById": {}
}
```

This endpoint is useful for quick dashboard loading, but the frontend should still maintain its own derived indexes from flat records.

### Live Stream

```http
GET /api/v1/stream
```

Server-Sent Events:

```text
event: hello
data: {"running":true,"port":17654,"records":0}

event: record
data: {...record...}
```

Recommended flow:

1. Fetch `/health`.
2. Fetch `/api/v1/records?limit=5000` for initial backfill.
3. Open `EventSource("/api/v1/stream")`.
4. Append every `record` event into the local trace store.
5. If SSE disconnects, show reconnecting state and let EventSource retry.
6. If SSE repeatedly fails, fallback to polling `/api/v1/records?after=<lastId>`.

### Recordings

Recording captures all VisibleFunction records from start to stop and writes a standalone JSON file when stopped.

```http
GET /api/v1/recording/status
GET /api/v1/recordings
GET /api/v1/recordings/latest
GET /api/v1/recordings/<id>
```

Status response:

```json
{
  "active": "false",
  "activeId": "none",
  "activeRecords": "0",
  "completed": "1",
  "latest": "20260624-153012"
}
```

Metadata response:

```json
{
  "recordings": [
    {
      "id": "20260624-153012",
      "startedAtMillis": 1782295812000,
      "endedAtMillis": 1782295820000,
      "durationMillis": 8000,
      "file": "visiblefunction-recordings/visiblefunction-recording-20260624-153012.json",
      "records": 128
    }
  ]
}
```

Latest or specific recording response:

```json
{
  "recording": {
    "id": "20260624-153012",
    "startedAtMillis": 1782295812000,
    "endedAtMillis": 1782295820000,
    "durationMillis": 8000,
    "file": "visiblefunction-recordings/visiblefunction-recording-20260624-153012.json",
    "records": 128
  },
  "data": {
    "counts": {},
    "commands": [],
    "events": [],
    "functions": [],
    "other": []
  }
}
```

Use recordings for the main WebView replay/export workflow.

## 3. Record Shape

Approximate record:

```json
{
  "id": 399,
  "type": "EVENT",
  "commandType": "data",
  "eventAction": "storage_modified",
  "groups": ["events", "functions"],
  "subject": "wtw:dice",
  "summary": "changed data",
  "timestampMillis": 1710000000000,
  "commandContext": {
    "command": "/data modify storage ...",
    "commandId": "386",
    "source": "function",
    "function": "wtw:test/test_dice",
    "functionCallId": "565"
  },
  "basicFields": {
    "command": "/data modify storage ...",
    "source": "function",
    "function": "wtw:test/test_dice",
    "position": "x=0.00, y=60.00, z=0.00"
  },
  "detailedFields": {}
}
```

Important fields:

- `id`: export-local monotonically increasing id from the latest export start.
- `type`: usually `COMMAND` or `EVENT`.
- `groups`: major buckets such as `commands`, `events`, `functions`, `other`.
- `commandType`: command category such as `summon`, `data`, `scoreboard`, `execute`.
- `eventAction`: semantic event action such as `storage_modified`, `scoreboard_score_set`, `item_given`.
- `timestampMillis`: wall-clock timestamp. Current backend does not expose a stable `tick` field yet.
- `commandContext.command`: raw command text.
- `commandContext.commandId`: relationship key between command and event.
- `commandContext.function`: datapack function id or `none`.
- `commandContext.functionCallId`: function call grouping key or `none`.
- `basicFields` and `detailedFields`: show all unknown fields in the details panel, because backend fields will continue to expand.

## 4. Visual Target

The UI should feel like a professional game-debugger timeline, not a generic web dashboard.

Recommended design language:

- background: near-black blue, `#080d14` to `#101722`
- panel background: `#111923`
- panel border: `#263447`
- grid lines: `#263242`
- primary text: `#f4f7fb`
- muted text: `#9aa7b8`
- tick green: `#63d66e`
- event purple: `#a66cff`
- function blue: `#62a8ff`
- command gold: `#f2c45b`
- recording red: `#ff5d5d`
- selected cyan: `#50d8ff`
- success green: `#55d66b`

Typography:

- UI text: Inter, system-ui, or a clean sans-serif.
- command and field values: JetBrains Mono, Cascadia Mono, or monospace.
- Keep font sizes compact: 12-14px body, 11-12px metadata.

No hero pages, no marketing cards, no large decorative gradients. The first screen is the debugger.

## 5. Layout Specification

Use a fixed application shell:

```text
+--------------------------------------------------------------+
| top app bar                                                  |
+------------+----------------------------------+--------------+
| left side  | central timeline                 | detail panel |
| filters    | lanes, grid, cards, commands     | selected     |
| search     |                                  | fields       |
+------------+----------------------------------+--------------+
| bottom status bar                                            |
+--------------------------------------------------------------+
```

Suggested dimensions:

- top bar: 64-78px
- left sidebar: 280-320px
- right detail panel: 320-380px
- bottom status bar: 32-44px
- central timeline fills remaining space

The layout should be usable at 1440x900 and excellent at 1920x1080.

## 6. Top App Bar

Match the reference image:

Left:

- Minecraft grass block style icon or simple square app icon.
- Title: `VisibleFunction`
- Subtitle: `Minecraft Datapack Debugger`

Center-left:

- Recording pill:

```text
red dot  RECORDING  00:01:28
```

If not recording:

```text
idle  last recording: 20260624-153012
```

Right actions:

- `Pause`: client-side pause of live rendering. Do not stop backend export.
- `Clear`: clear current frontend store/view only. Do not delete backend recordings.
- `Export`: download current visible dataset or latest recording JSON.
- Settings icon: opens base URL, reconnect, display density, theme options.

Recording display should poll `/api/v1/recording/status` every 1s while connected.

## 7. Left Sidebar

Sections should match the image.

### Session

Show:

- world: use `basicFields.dimension` if available; otherwise `minecraft:overworld` fallback
- started: derived from first record timestamp or active recording metadata
- duration: recording duration or elapsed live session time
- ticks captured: if backend tick is unavailable, show approximate bucket count or `not available`

### Tick Range

Until backend exposes true tick IDs, treat the range as a time-window control:

- label it `Time Range` if using `timestampMillis`
- switch to `Tick Range` when records expose a stable tick field

Controls:

- two numeric inputs
- range slider
- show min/max labels

### Filters

Toggle rows:

- Tick
- Event
- Function
- Commands
- Hide Idle Ticks

Hide Idle Ticks means hide empty time buckets in the timeline.

### Search

Search across:

- record id
- type
- subject
- summary
- command text
- function id
- command type
- event action
- all basic/detailed field values

Shortcut:

```text
Ctrl+K
```

### Quick Views

Suggested presets:

- Recent Damage
- Storage Writes
- Motion Updates
- Scoreboard Ops
- Function Calls
- Execute Chains

Each preset is just a saved filter/query.

## 8. Central Timeline

This is the main view from the reference image.

Lanes:

```text
TICK
EVENT
FUNCTION
COMMANDS
```

Header controls:

- color legend: Tick, Event, Function, Commands
- zoom out
- zoom in
- bucket size dropdown: `1 Tick`, `5 Ticks`, `20 Ticks`, or time fallback such as `50ms`, `250ms`, `1s`
- Auto Scroll toggle

### Current Backend Constraint

Current records expose `timestampMillis`, not stable game tick. For the first WebView MVP:

- build buckets by `timestampMillis`
- choose an approximate bucket size such as 50ms for live view
- display bucket headers as time offsets
- if `basicFields.tick` or `detailedFields.tick` appears later, switch to true tick grouping automatically

Recommended helper:

```ts
function recordTickKey(record: TraceRecord): string {
  return (
    record.basicFields.tick ??
    record.detailedFields.tick ??
    String(Math.floor(record.timestampMillis / 50))
  )
}
```

### Bucket Model

Use a bucket layer before rendering.

```ts
type TimelineBucket = {
  key: string
  startMillis: number
  endMillis: number
  records: TraceRecord[]
  commands: TraceRecord[]
  events: TraceRecord[]
  functions: TraceRecord[]
  byFunctionCallId: Map<string, TraceRecord[]>
  byCommandId: Map<string, TraceRecord[]>
}
```

### Tick Lane

Render small green vertical bars or compact segments across every bucket. This lane is the rhythm of the game loop.

If there are no records in a bucket, draw a faint idle tick marker only when `Hide Idle Ticks` is off.

### Event Lane

Render purple event pills:

```text
player_hit
damage_calc_start
result_event
storage_modified
scoreboard_score_set
```

For multiple events in one bucket:

- show the most important action label
- show count badge, e.g. `+12`
- detail panel should list all records in the bucket

### Function Lane

Render blue function-call cards:

```text
damage_modifier_notcritical
41 cmds
```

Group by `commandContext.functionCallId` when available. If not available, group by `commandContext.function`.

Clicking a function card selects the function call and fills the right detail panel with:

- function id
- functionCallId
- command count
- event count
- first/last record
- child commands/events

### Commands Lane

Render gold command stacks under function cards.

Command stack style:

- left column: sequence or record id
- main text: command preview
- selected row: bright gold/cyan outline
- collapsed rows use `...`

Commands should be grouped under their function call when possible.

If command has child events, draw dotted connector lines from command row to event/function marker.

## 9. Bottom Minimap

The bottom minimap is a compressed timeline overview.

Rows:

- Tick: green density
- Event: purple density
- Function: blue density
- Commands: gold density

Features:

- draggable viewport window
- click to jump
- left/right arrow buttons for paging
- show current range in bottom status bar

This can be implemented with divs or canvas. For MVP, div-based bars are fine.

## 10. Right Detail Panel

Header:

```text
SELECTED ITEM
close button
```

Selected command example:

```text
Command

Type          command
Tick          24082
Sequence      27
Function      wtw:fight_system/damage_system/logic_engine/damage_modifier_notcritical
Executor      mannequin
Position      0.00, 60.00, 0.00
Storage Path  wtw:temp display.value
Operation     data modify storage
Target        storage
Arguments     {color:"red",bold:false,...}
Result        Success
Duration      0.042 ms
Notes         -
```

Current backend does not expose duration/result for every command. Show `-` when missing.

Detail panel rules:

- Always show `id`, `type`, `subject`, `summary`.
- Show command context as a first-class section.
- Show all `basicFields`.
- Show all `detailedFields`.
- Unknown fields should remain visible.
- Provide copy buttons for command, function id, storage path, and JSON.
- Prev/Next buttons navigate within current filtered result set.

## 11. Record Relationships

Build frontend indexes immediately after loading records.

```ts
type TraceIndexes = {
  recordsById: Map<number, TraceRecord>
  commandsByCommandId: Map<string, TraceRecord>
  eventsByCommandId: Map<string, TraceRecord[]>
  recordsByFunctionCallId: Map<string, TraceRecord[]>
  functionCallsByFunctionId: Map<string, Set<string>>
  recordsByFunctionId: Map<string, TraceRecord[]>
}
```

Relationship rules:

- A command is a parent of events where `event.commandContext.commandId === command.commandContext.commandId`.
- A function card contains records with the same `functionCallId`.
- If `functionCallId` is `none`, fallback to grouping by function id and local bucket.
- Do not parse human-readable command text unless no structured field exists.

## 12. Recording Workflow

The WebView should support two modes.

### Live Mode

Source:

- `/api/v1/records`
- `/api/v1/stream`

Behavior:

- append records continuously
- show recording state from `/api/v1/recording/status`
- Pause button only freezes UI updates; keep buffering incoming records
- Resume applies buffered records
- Clear button clears frontend store and refetches from current state only if user asks

### Recording Replay Mode

Source:

- `/api/v1/recordings/latest`
- `/api/v1/recordings/<id>`

Behavior:

- load a completed recording as an immutable dataset
- timeline range uses recording start/end
- Export button downloads this JSON
- No auto-scroll unless user returns to live mode

Top bar should make the mode obvious:

```text
LIVE RECORDING
REPLAY 20260624-153012
```

## 13. Suggested Component Structure

React + Vite is a good default.

```text
src/api/visibleFunctionClient.ts
src/store/traceStore.ts
src/store/traceIndexes.ts
src/store/timelineBuckets.ts
src/components/AppShell.tsx
src/components/TopBar.tsx
src/components/Sidebar.tsx
src/components/Timeline/Timeline.tsx
src/components/Timeline/TimelineHeader.tsx
src/components/Timeline/TimelineLane.tsx
src/components/Timeline/CommandStack.tsx
src/components/Timeline/FunctionCard.tsx
src/components/Timeline/Minimap.tsx
src/components/DetailPanel.tsx
src/components/SearchBox.tsx
src/components/FilterPanel.tsx
src/components/RecordingPicker.tsx
```

Keep API, state, derived indexes, and rendering separated.

## 14. TypeScript Types

Use explicit types.

```ts
export type TraceRecord = {
  id: number
  type: "COMMAND" | "EVENT" | string
  commandType: string
  eventAction: string
  groups: string[]
  subject: string
  summary: string
  timestampMillis: number
  commandContext: {
    command: string
    commandId: string
    source: string
    function: string
    functionCallId: string
  }
  basicFields: Record<string, string>
  detailedFields: Record<string, string>
}

export type RecordingMetadata = {
  id: string
  startedAtMillis: number
  endedAtMillis: number
  durationMillis: number
  file: string
  records: number
}

export type RecordingStatus = {
  active: string
  activeId: string
  activeRecords: string
  completed: string
  latest: string
}
```

Note: current recording status values are strings because the backend status helper serializes them as strings. Normalize in the frontend:

```ts
const active = status.active === "true"
const activeRecords = Number(status.activeRecords || 0)
```

## 15. Interaction Details

Required MVP interactions:

- click record: select and show details
- click function card: select function group
- click command row: select command
- click event pill: select event
- double-click command/event/function: zoom timeline to its local bucket
- Ctrl+K: focus search
- Escape: clear search or close settings/detail overlay
- Auto Scroll: when on, keep latest records visible
- Pause: freeze timeline rendering but keep buffering SSE records
- Export: download current dataset as JSON

Selection should be synchronized:

- selected item highlighted in timeline
- selected item shown in right detail panel
- related records highlighted with a softer outline

## 16. Empty and Error States

Disconnected:

```text
Cannot connect to VisibleFunction export server.
Run /visiblefunction export start in Minecraft.
```

No records:

```text
No trace records yet.
Start a recording or run datapack commands in-game.
```

No recording:

```text
No completed recordings.
Press ] in-game to record a trace segment.
```

Invalid JSON/SSE error:

- keep last good data visible
- show small warning in top bar
- retry stream

High throughput:

- batch state updates with `requestAnimationFrame`
- virtualize long lists
- avoid rendering every record as a DOM node in dense timeline mode
- render buckets and summaries first, details only on selection

## 17. MVP Acceptance Checklist

The first frontend pass is good enough when:

- it visually resembles the reference screenshot
- it connects to `http://127.0.0.1:17654`
- it loads live records
- it opens SSE and appends records
- it shows recording active/idle state
- it can load `/api/v1/recordings/latest`
- it has left filters and search
- it shows the central four-lane timeline
- it groups function calls and command stacks
- it shows selected item details on the right
- it can export/download the current JSON dataset

Do not spend the first pass on advanced animations, perfect tick semantics, or backend mutations. The visual shell, record ingestion, grouping, and detail navigation matter most.
