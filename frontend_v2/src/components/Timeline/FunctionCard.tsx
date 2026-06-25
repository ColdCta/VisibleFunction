type Props = {
  name: string;
  cmds: number;
  events: number;
  selected: boolean;
  dim: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
};

export function FunctionCard({ name, cmds, events, selected, dim, onClick, onDoubleClick }: Props) {
  return (
    <div
      className={"funcard" + (selected ? " is-selected" : "") + (dim ? " is-dim" : "")}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      tabIndex={0}
      role="button"
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onClick();
        }
      }}
      title={name}
    >
      <div className="funcard__name mono">{shortName(name)}</div>
      <div className="funcard__meta">
        <span className="mono">{cmds} cmds</span>
        {events > 0 && <span className="muted"> · {events} ev</span>}
      </div>
    </div>
  );
}

function shortName(name: string): string {
  if (name.length <= 28) return name;
  return "…" + name.slice(-27);
}
