import { Link } from "react-router-dom";

/** Brand mark: a cup with rising steam. Clicking it always goes to the home page. */
export default function Logo({ size = 32, showName = true, linked = true }) {
  const content = (
    <>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M12 6.5c-1 1.2 1 2.3 0 3.5M15.5 5.5c-1 1.4 1 2.8 0 4.5M19 6.5c-1 1.2 1 2.3 0 3.5" stroke="var(--crema)" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        <path d="M8.5 13.5h14v4.5a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6z" fill="#fff" />
        <path d="M22.5 15h1.2a2.6 2.6 0 0 1 0 5.2h-1.6" stroke="#fff" strokeWidth="1.8" fill="none" />
      </svg>
      {showName && (
        <span className="logo-name">
          MIST <span>Meet</span>
        </span>
      )}
    </>
  );
  if (!linked) return <span className="logo">{content}</span>;
  return (
    <Link to="/" className="logo" aria-label="MIST Meet home">
      {content}
    </Link>
  );
}
