# VisibleFunction Datapack Analysis API

Static datapack analysis is exposed as a cached backend snapshot. It scans the
currently loaded server datapacks, parses `.mcfunction` files and function tags,
then returns function relationships and detected datapack variables.

This API is independent from the live trace stream. It does not change
`TraceRecord`, `/api/v1/records`, `/api/v1/tick-filter`, recordings, or SSE.

## Endpoint

```http
GET http://127.0.0.1:<exportPort>/api/v1/datapack-analysis
```

Default port:

```text
17654
```

The export server must be running:

```mcfunction
/visiblefunction export start
```

The response is a cached snapshot. The mod rebuilds it when:

- the Minecraft server starts
- datapacks reload successfully
- the server stops, which clears the snapshot

Requests do not rescan datapacks, so the endpoint is safe for frontend polling
or on-demand loading.

## Response Shape

```ts
type DatapackAnalysisResponse = {
  analysis: {
    generatedAtMillis: number;
    functionCount: number;
    edgeCount: number;
    variableCount: number;
    warnings: string[];
  };
  functions: AnalyzedFunction[];
  edges: FunctionEdge[];
  variables: DatapackVariable[];
  tags: Record<string, string[]>;
};
```

## Function Object

```ts
type AnalyzedFunction = {
  id: string;
  pack: string;
  lineCount: number;
  commandCount: number;
  tickRoot: boolean;
  tickFunction: boolean;
  calls: string[];
  calledBy: string[];
  variables: string[];
};
```

Fields:

- `id`: function id, for example `demo:spawn_wave`.
- `pack`: source pack id reported by Minecraft.
- `lineCount`: total physical lines in the `.mcfunction` file.
- `commandCount`: non-blank, non-comment command lines.
- `tickRoot`: true when directly listed in `minecraft:tick`.
- `tickFunction`: true when reachable from the `minecraft:tick` function chain.
- `calls`: direct concrete function targets this function calls.
- `calledBy`: concrete functions that call this function.
- `variables`: variable keys detected inside this function.

## Edge Object

```ts
type FunctionEdge = {
  from: string;
  to: string;
  kind: "direct" | "tag" | "scheduled" | string;
  viaTag: string;
  line: number;
  command: string;
};
```

Fields:

- `from`: source function id.
- `to`: target function id. If a function tag is missing or empty, this may be
  `#namespace:tag`.
- `kind`: call style.
- `viaTag`: tag id when `kind === "tag"`, otherwise `"none"`.
- `line`: source `.mcfunction` line number.
- `command`: normalized command text.

Recognized function references:

- `/function namespace:path`
- `/function #namespace:tag`
- `/execute ... run function namespace:path`
- `/return run function namespace:path`
- `/schedule function namespace:path ...`

## Variable Object

```ts
type DatapackVariable = {
  key: string;
  kind: "scoreboard" | "score" | "storage" | "tag" | "bossbar" | string;
  name: string;
  reads: number;
  writes: number;
  occurrences: VariableOccurrence[];
};

type VariableOccurrence = {
  function: string;
  line: number;
  access: "read" | "write" | "update" | "query" | "declare" | "remove" | string;
  command: string;
};
```

Variable key format:

- `scoreboard:<objective>`
- `score:<holder>:<objective>`
- `storage:<namespace:id> <path>`
- `storage:<namespace:id>` for root storage access
- `tag:<tag>`
- `bossbar:<namespace:id>`

Access meanings:

- `read`: command reads an existing value or selector condition.
- `write`: command overwrites or stores a value.
- `update`: command mutates an existing value.
- `query`: command lists/gets data without mutating it.
- `declare`: command creates a variable-like object.
- `remove`: command removes or resets it.

Covered MVP command families:

- `scoreboard objectives ...`
- `scoreboard players ...`
- `execute store ... score`
- `execute if/unless score ...`
- `data ... storage ...`
- `execute store ... storage`
- `tag ... add/remove/list`
- `bossbar ...`
- selector score/tag filters, for example `@e[scores={x=1..},tag=boss]`

Macro commands beginning with `$` are skipped and reported in `warnings`.

## Tags Object

```ts
type Tags = Record<string, string[]>;
```

Example:

```json
{
  "minecraft:tick": ["demo:tick"],
  "demo:wave": ["demo:spawn_wave", "demo:spawn_boss"]
}
```

Nested function tags are resolved into concrete function ids. Recursive or
invalid tag references are reported in `analysis.warnings`.

## Example

```json
{
  "analysis": {
    "generatedAtMillis": 1782356333000,
    "functionCount": 2,
    "edgeCount": 1,
    "variableCount": 2,
    "warnings": []
  },
  "functions": [
    {
      "id": "demo:tick",
      "pack": "file/demo",
      "lineCount": 3,
      "commandCount": 2,
      "tickRoot": true,
      "tickFunction": true,
      "calls": ["demo:spawn_wave"],
      "calledBy": [],
      "variables": ["scoreboard:wave"]
    },
    {
      "id": "demo:spawn_wave",
      "pack": "file/demo",
      "lineCount": 4,
      "commandCount": 3,
      "tickRoot": false,
      "tickFunction": true,
      "calls": [],
      "calledBy": ["demo:tick"],
      "variables": ["score:#wave:wave", "scoreboard:wave", "storage:demo:cache wave.current"]
    }
  ],
  "edges": [
    {
      "from": "demo:tick",
      "to": "demo:spawn_wave",
      "kind": "direct",
      "viaTag": "none",
      "line": 2,
      "command": "/function demo:spawn_wave"
    }
  ],
  "variables": [
    {
      "key": "scoreboard:wave",
      "kind": "scoreboard",
      "name": "wave",
      "reads": 1,
      "writes": 1,
      "occurrences": [
        {
          "function": "demo:tick",
          "line": 1,
          "access": "read",
          "command": "/execute if score #wave wave matches 1.. run function demo:spawn_wave"
        },
        {
          "function": "demo:spawn_wave",
          "line": 2,
          "access": "update",
          "command": "/scoreboard players add #wave wave 1"
        }
      ]
    }
  ],
  "tags": {
    "minecraft:tick": ["demo:tick"]
  }
}
```

## Frontend Usage Notes

Recommended views:

- Function graph: use `functions`, `edges`, `tickRoot`, and `tickFunction`.
- Variable inspector: group `variables` by `kind`, then show occurrences by
  function and line.
- Tick source explanation: functions with `tickFunction: true` can be shown as
  static tick-chain sources even before live records appear.
- Warning panel: show `analysis.warnings` as non-fatal parser notes.

Suggested fetch:

```ts
async function loadDatapackAnalysis(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/v1/datapack-analysis`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Datapack analysis failed: ${res.status}`);
  return res.json() as Promise<DatapackAnalysisResponse>;
}
```
