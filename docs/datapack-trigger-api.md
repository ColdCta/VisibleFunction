# Datapack Trigger API

VisibleFunction scans the currently loaded datapacks for functions invoked by
advancements and enchantments. The result is cached during datapack reload and
is exposed separately from live trace records.

## Endpoint

```http
GET http://127.0.0.1:<exportPort>/api/v1/datapack-triggers
```

Start the local export server first:

```mcfunction
/visiblefunction export start
```

The index is rebuilt after `SERVER_STARTED` and every successful datapack
reload. Requests only read the cached snapshot.

This endpoint describes static trigger declarations. It does not claim that an
advancement or enchantment has executed during the current live session.

## Runtime Attribution

VisibleFunction also attributes commands when these triggers execute:

- `AdvancementRewards.grant()` is matched to its loaded advancement and reward
  function.
- Each decoded enchantment `RunFunction` effect instance is identity-mapped to
  its enchantment during server start and datapack reload.
- The trigger context is captured by the function call frame and inherited by
  nested functions.

Commands executed by a triggered function include these fields:

```json
{
  "commandContext": {
    "triggerType": "enchantment",
    "triggerId": "demo:impact",
    "triggerFunction": "demo:on_hit"
  },
  "basicFields": {
    "trigger_type": "enchantment",
    "trigger_id": "demo:impact",
    "trigger_function": "demo:on_hit"
  },
  "detailedFields": {
    "trigger_actor": "Player",
    "trigger_actor_entity": "minecraft:player <uuid>",
    "trigger_position": "x=0.00, y=64.00, z=0.00",
    "trigger_dimension": "minecraft:overworld"
  }
}
```

For advancement rewards, `triggerId` is the advancement ID and the actor is
the player receiving the reward. For enchantments, `triggerId` is the
enchantment ID and the actor/position come directly from `RunFunction.apply()`.
If an enchantment effect is created outside the loaded registry, its fallback
ID is `unknown` while the actual function, entity, and position are still
recorded.

## Sources

The scanner supports both current and legacy resource paths:

```text
data/<namespace>/advancement/**/*.json
data/<namespace>/advancements/**/*.json
data/<namespace>/enchantment/**/*.json
data/<namespace>/enchantments/**/*.json
```

Advancement edges are read from:

```json
{
  "rewards": {
    "function": "demo:on_complete"
  }
}
```

Enchantment effect trees are traversed recursively, including nested
`minecraft:all_of` effects:

```json
{
  "effects": {
    "minecraft:post_attack": [
      {
        "enchanted": "attacker",
        "affected": "victim",
        "effect": {
          "type": "minecraft:run_function",
          "function": "demo:on_hit"
        },
        "requirements": {
          "condition": "minecraft:entity_properties"
        }
      }
    ]
  }
}
```

## Response

```ts
type DatapackTriggerResponse = {
  analysis: {
    generatedAtMillis: number;
    advancementResourceCount: number;
    enchantmentResourceCount: number;
    advancementSourceCount: number;
    enchantmentSourceCount: number;
    advancementTriggerCount: number;
    enchantmentTriggerCount: number;
    triggerCount: number;
    functionCount: number;
    warnings: string[];
  };
  advancements: AdvancementTriggerSource[];
  enchantments: EnchantmentTriggerSource[];
  triggers: DatapackTriggerEdge[];
  functions: TriggeredFunction[];
};

type AdvancementTriggerSource = {
  id: string;
  pack: string;
  parent: string | "none";
  function: string;
  triggerId: string;
  criteria: Array<{
    name: string;
    trigger: string;
  }>;
};

type EnchantmentTriggerSource = {
  id: string;
  pack: string;
  supportedItems: string;
  primaryItems: string;
  slots: string[];
  functions: string[];
  triggerIds: string[];
  triggerCount: number;
};

type DatapackTriggerEdge = {
  id: string;
  sourceType: "advancement" | "enchantment";
  sourceId: string;
  kind: "reward" | "run_function";
  function: string;
  pack: string;
  effectComponent: string | "none";
  jsonPath: string;
  conditionSummary: string;
  affected: string | "none";
  enchanted: string | "none";
  functionExists: boolean;
  tickFunction: boolean;
};

type TriggeredFunction = {
  id: string;
  functionExists: boolean;
  tickFunction: boolean;
  triggerCount: number;
  triggerIds: string[];
  advancements: string[];
  enchantments: string[];
};
```

Only advancement and enchantment resources that actually reference functions
are included in their respective arrays. The resource counts in `analysis`
still report every scanned resource.

## Example

```json
{
  "analysis": {
    "generatedAtMillis": 1782612000000,
    "advancementResourceCount": 1280,
    "enchantmentResourceCount": 42,
    "advancementSourceCount": 1,
    "enchantmentSourceCount": 1,
    "advancementTriggerCount": 1,
    "enchantmentTriggerCount": 1,
    "triggerCount": 2,
    "functionCount": 2,
    "warnings": []
  },
  "advancements": [
    {
      "id": "demo:story/start",
      "pack": "file/demo",
      "parent": "minecraft:story/root",
      "function": "demo:on_complete",
      "triggerId": "advancement:demo:story/start:12ab34cd",
      "criteria": [
        {
          "name": "entered_world",
          "trigger": "minecraft:tick"
        }
      ]
    }
  ],
  "enchantments": [
    {
      "id": "demo:impact",
      "pack": "file/demo",
      "supportedItems": "#minecraft:enchantable/weapon",
      "primaryItems": "",
      "slots": ["mainhand"],
      "functions": ["demo:on_hit"],
      "triggerIds": ["enchantment:demo:impact:56ef78ab"],
      "triggerCount": 1
    }
  ],
  "triggers": [
    {
      "id": "enchantment:demo:impact:56ef78ab",
      "sourceType": "enchantment",
      "sourceId": "demo:impact",
      "kind": "run_function",
      "function": "demo:on_hit",
      "pack": "file/demo",
      "effectComponent": "minecraft:post_attack",
      "jsonPath": "$.effects[\"minecraft:post_attack\"][0][\"effect\"]",
      "conditionSummary": "{\"condition\":\"minecraft:entity_properties\"}",
      "affected": "victim",
      "enchanted": "attacker",
      "functionExists": true,
      "tickFunction": false
    }
  ],
  "functions": [
    {
      "id": "demo:on_hit",
      "functionExists": true,
      "tickFunction": false,
      "triggerCount": 1,
      "triggerIds": ["enchantment:demo:impact:56ef78ab"],
      "advancements": [],
      "enchantments": ["demo:impact"]
    }
  ]
}
```

## Frontend Notes

- Render `triggers` when a source-to-function graph is needed.
- Use `functions` for a reverse "what can trigger this function?" inspector.
- Use `jsonPath` to identify multiple `run_function` effects in one
  enchantment.
- Show `conditionSummary`, `affected`, and `enchanted` in edge details.
- Treat `warnings` as non-fatal parser diagnostics.
