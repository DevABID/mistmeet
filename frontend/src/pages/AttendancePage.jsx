import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp, Download, RefreshCw, Search } from "lucide-react";
import Logo from "../components/Logo.jsx";
import Avatar from "../components/Avatar.jsx";
import { api, downloadFile } from "../api.js";

export function formatDuration(seconds = 0) {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-");

const COLUMNS = [
  { key: "name", label: "Name" },
  { key: "first_joined", label: "First joined" },
  { key: "last_left", label: "Last left" },
  { key: "total_seconds", label: "Time in meeting" },
  { key: "sessions", label: "Sessions" },
  { key: "attendance_percent", label: "Attendance" },
  { key: "messages", label: "Chat msgs" },
];

export default function AttendancePage() {
  const { code } = useParams();
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "first_joined", dir: 1 });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api(`/meetings/${code}/attendance/`));
      setError("");
    } catch (e) {
      setError(e.status === 403 ? "Only the meeting host can see attendance." : e.status === 404 ? "There's no meeting with this code." : e.message);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => { load(); }, [load]);

  // While the call is in progress, refresh every 15 seconds.
  const live = report?.meeting.is_active && report?.participants.some((p) => p.in_call);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [live, load]);

  const rows = useMemo(() => {
    if (!report) return [];
    const q = query.trim().toLowerCase();
    const filtered = report.participants.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.username.toLowerCase().includes(q)
    );
    return [...filtered].sort((a, b) => {
      let x = a[sort.key];
      let y = b[sort.key];
      if (sort.key === "last_left") {
        x = a.in_call ? Infinity : new Date(x).getTime();
        y = b.in_call ? Infinity : new Date(y).getTime();
      } else if (sort.key === "first_joined") {
        x = new Date(x).getTime();
        y = new Date(y).getTime();
      } else if (typeof x === "string") {
        return x.localeCompare(y) * sort.dir;
      }
      return (x - y) * sort.dir;
    });
  }, [report, query, sort]);

  async function downloadPdf() {
    setDownloading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await downloadFile(`/meetings/${code}/attendance/pdf/?tz=${encodeURIComponent(tz)}`, `attendance-${code}.pdf`);
    } catch (e) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "name" ? 1 : -1 }));

  return (
    <div className="report-page">
      <header className="home-header">
        <Logo />
        <Link to="/" className="back-link"><ArrowLeft size={18} /> Back to home</Link>
      </header>

      <main className="report-main">
        {error && !report && (
          <div className="status-body">
            <h1>Can't show this report</h1>
            <p className="muted">{error}</p>
          </div>
        )}
        {!report && !error && <div className="screen-center"><div className="spinner" /></div>}

        {report && (
          <>
            <div className="report-head">
              <div>
                <div className="report-title-row">
                  <h1>Attendance report</h1>
                  {live ? (
                    <span className="pill pill-live"><span className="live-dot" /> Live</span>
                  ) : (
                    <span className="pill">{report.meeting.ended_at ? "Ended" : "No one in the call"}</span>
                  )}
                </div>
                <p className="report-subtitle">{report.meeting.title || "Untitled meeting"}</p>
                <p className="muted small">
                  {report.meeting.code} • Host: {report.meeting.host_name} • Started {fmtDateTime(report.meeting.started_at)}
                  {report.meeting.ended_at && ` • Ended ${fmtTime(report.meeting.ended_at)}`}
                </p>
              </div>
              <div className="report-actions">
                <button className="btn btn-ghost" onClick={load} disabled={loading}>
                  <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
                </button>
                <button className="btn btn-primary" onClick={downloadPdf} disabled={downloading}>
                  <Download size={16} /> {downloading ? "Preparing PDF…" : "Download PDF"}
                </button>
              </div>
            </div>
            {error && <p className="form-error">{error}</p>}

            <dl className="report-stats">
              <Stat value={report.summary.attendees} label="People attended" />
              <Stat value={report.summary.peak} label="Most at one time" />
              <Stat value={formatDuration(report.summary.average_seconds)} label="Average time per person" />
              <Stat value={formatDuration(report.meeting.duration_seconds)} label={live ? "Meeting length so far" : "Meeting length"} />
              <Stat value={report.summary.declined} label="Requests declined" />
            </dl>

            <section className="report-card">
              <div className="report-card-head">
                <h2>Participants ({report.participants.length})</h2>
                <div className="input-icon report-search">
                  <Search size={16} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or email" aria-label="Search participants" />
                </div>
              </div>

              {report.participants.length === 0 ? (
                <p className="muted empty">No one has joined yet. Attendance appears here as soon as people are let in.</p>
              ) : (
                <div className="table-scroll">
                  <table className="report-table">
                    <thead>
                      <tr>
                        {COLUMNS.map((c) => (
                          <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
                            <button onClick={() => toggleSort(c.key)}>
                              {c.label}
                              {sort.key === c.key && (sort.dir > 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.username}>
                          <td>
                            <div className="report-person">
                              <Avatar name={p.name} size={32} />
                              <div>
                                <strong>{p.name}</strong>
                                {p.is_host && <span className="tag">Host</span>}
                                <span className="muted small">{p.email || `@${p.username}`}</span>
                              </div>
                            </div>
                          </td>
                          <td>{fmtDateTime(p.first_joined)}</td>
                          <td>{p.in_call ? <span className="in-call">In the call</span> : fmtTime(p.last_left)}</td>
                          <td className="num">{formatDuration(p.total_seconds)}</td>
                          <td className="num">{p.sessions}</td>
                          <td>
                            <div className="bar-cell">
                              <span className="bar-track"><span style={{ width: `${p.attendance_percent}%` }} /></span>
                              <span className="num">{p.attendance_percent}%</span>
                            </div>
                          </td>
                          <td className="num">{p.messages}</td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={COLUMNS.length} className="muted">No participants match “{query}”.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {report.declined.length > 0 && (
              <section className="report-card">
                <h2>Requests declined ({report.declined.length})</h2>
                <ul className="declined-list">
                  {report.declined.map((d, i) => (
                    <li key={i}>
                      <strong>{d.name}</strong>
                      <span className="muted small">{d.email}</span>
                      <span className="muted small">Asked at {fmtTime(d.requested_at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="muted small report-note">
              Time in meeting counts from when someone was let in until they left. If a person rejoined or was on two
              devices at once, overlapping time is counted once. Attendance is their time divided by the meeting length.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}
