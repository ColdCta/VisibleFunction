export type QuickViewId =
  | "recent-damage"
  | "storage-writes"
  | "motion-updates"
  | "scoreboard-ops"
  | "function-calls"
  | "execute-chains";

export type QuickView = {
  id: QuickViewId;
  label: string;
  icon: string;
  query: string;
};

export const QuickViewPresets: QuickView[] = [
  { id: "recent-damage", label: "Recent Damage", icon: "🗡", query: "damage" },
  { id: "storage-writes", label: "Storage Writes", icon: "🗄", query: "storage" },
  { id: "motion-updates", label: "Motion Updates", icon: "↗", query: "motion" },
  { id: "scoreboard-ops", label: "Scoreboard Ops", icon: "📊", query: "scoreboard" },
  { id: "function-calls", label: "Function Calls", icon: "ƒ", query: "function" },
  { id: "execute-chains", label: "Execute Chains", icon: "🧩", query: "execute" },
];
