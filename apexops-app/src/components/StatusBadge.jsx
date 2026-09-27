import { STATUS_COLORS } from '../lib/mock';

export default function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS["LOGGED"];
  return (
    <span style={{
      background: c.badge,
      color: "#fff",
      borderRadius: 4,
      padding: "2px 10px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.5,
      whiteSpace: "nowrap",
    }}>
      {status}
    </span>
  );
}
