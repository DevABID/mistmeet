export default function Logo({ size = 32, showName = true, light = false }) {
  return (
    <span className={`logo ${light ? "logo-light" : ""}`}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <path d="M8 11.5h16M8 16h12M8 20.5h8" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {showName && (
       <a href="/" className=""> <span className="logo-name">
          MIST <span>Meet</span>
        </span></a>
      )}
    </span>
  );
}
