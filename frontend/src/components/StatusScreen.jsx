import Logo from "./Logo.jsx";

export default function StatusScreen({ title, body, onRejoin, rejoinLabel = "Rejoin", onHome }) {
  return (
    <div className="status-screen">
      <header className="home-header"><Logo /></header>
      <div className="status-body">
        <h1>{title}</h1>
        {body && <p className="muted">{body}</p>}
        <div className="status-actions">
          {onRejoin && <button className="btn btn-ghost" onClick={onRejoin}>{rejoinLabel}</button>}
          {onHome && <button className="btn btn-primary" onClick={onHome}>Return to home screen</button>}
        </div>
      </div>
    </div>
  );
}
