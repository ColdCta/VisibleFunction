export type QuickViewId =
  | "storage-writes"
  | "scoreboard-ops"
  | "function-calls"
  | "execute-chains"
  | "recent-damage"
  | "motion-updates";

export type QuickView = {
  id: QuickViewId;
  label: string;
  icon: string;
  query: string;
};

// Per docs §7 :411-416. `storage`/`scoreboard`/`function`/`execute` map to real backend fields;
// `damage`/`motion` only match when datapack names contain those substrings.
export const QuickViewPresets: QuickView[] = [
  { id: "storage-writes", label: "Storage Writes", icon: "🗄", query: "storage" },
  { id: "scoreboard-ops", label: "Scoreboard Ops", icon: "📊", query: "scoreboard" },
  { id: "function-calls", label: "Function Calls", icon: "ƒ", query: "function" },
  { id: "execute-chains", label: "Execute Chains", icon: "🧩", query: "execute" },
  { id: "recent-damage", label: "Recent Damage", icon: "🗡", query: "damage" },
  { id: "motion-updates", label: "Motion Updates", icon: "↗", query: "motion" },
];
