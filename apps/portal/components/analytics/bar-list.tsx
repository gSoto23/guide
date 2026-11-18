/**
 * Bars drawn with plain markup (research R10): each row shows its label and numbers as text, and the
 * bar is decoration only, so the list reads the same without it (FR-014).
 */
export function BarList({
  label,
  rows,
  empty,
}: {
  label: string;
  rows: { key: string; name: string; value: number; display: string; detail?: string }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="list-plain bar-list" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} className="bar-row">
          <span className="bar-label">{row.name}</span>
          <span className="bar-value">
            {row.display}
            {row.detail ? <span className="muted"> · {row.detail}</span> : null}
          </span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
