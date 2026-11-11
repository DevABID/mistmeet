const PALETTE = ["#6B4226", "#8A5A3B", "#4F7A3A", "#A0522D", "#5B6E7A", "#8C4A5E", "#7A6A2F", "#3E5F5A"];

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function colorFor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export default function Avatar({ name, size = 40 }) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
