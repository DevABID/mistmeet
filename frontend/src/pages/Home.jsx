import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, Check, ClipboardList, Copy, Keyboard, Link2, LogOut, Plus, Trash2, Video, X } from "lucide-react";
import Logo from "../components/Logo.jsx";
import Avatar from "../components/Avatar.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api, CODE_RE, meetingLink } from "../api.js";
import { useClock } from "../hooks/useClock.js";
import { formatDuration } from "./AttendancePage.jsx";

export default function Home() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const now = useClock(30000);
  const [menuOpen, setMenuOpen] = useState(false);
  const [joinValue, setJoinValue] = useState("");
  const [joinError, setJoinError] = useState("");
  const [meetings, setMeetings] = useState([]);
  const [pastMeetings, setPastMeetings] = useState([]);
  const [listTab, setListTab] = useState("upcoming");
  const [modal, setModal] = useState(null); // {type:'link', meeting} | {type:'schedule'}
  const menuRef = useRef(null);

  const loadMeetings = () => {
    api("/meetings/").then(setMeetings).catch(() => {});
    api("/meetings/?scope=past").then(setPastMeetings).catch(() => {});
  };
  useEffect(() => { loadMeetings(); }, []);

  useEffect(() => {
    const close = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function createMeeting(body = {}) {
    return api("/meetings/", { method: "POST", body });
  }

  async function startInstant() {
    setMenuOpen(false);
    const m = await createMeeting({ title: "" });
    navigate(`/${m.code}`);
  }

  async function createForLater() {
    setMenuOpen(false);
    const m = await createMeeting({ title: "" });
    setModal({ type: "link", meeting: m });
    loadMeetings();
  }

  function join(e) {
    e.preventDefault();
    const match = joinValue.trim().toLowerCase().match(CODE_RE);
    if (!match) {
      setJoinError("Enter a code like abc-defg-hij or paste the full meeting link.");
      return;
    }
    navigate(`/${match[1]}`);
  }

  async function remove(code) {
    await api(`/meetings/${code}/`, { method: "DELETE" });
    loadMeetings();
  }

  return (
    <div className="home">
      <header className="home-header">
        <Logo />
        <div className="home-header-right">
          <span className="muted home-date">
            {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} •{" "}
            {now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
          </span>
          <Avatar name={user.display_name} size={34} />
          <button className="icon-btn-light" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="home-main">
        <section className="home-intro">
          <h1>Video meetings for teams that need to get work done</h1>
          <p className="lead">
            Start a call in one click, or share a code so colleagues can join from any browser. No installs.
          </p>

          <div className="home-actions">
            <div className="menu-anchor" ref={menuRef}>
              <button className="btn btn-primary" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
                <Video size={18} /> New meeting
              </button>
              {menuOpen && (
                <div className="menu" role="menu">
                  <button role="menuitem" onClick={startInstant}><Plus size={18} /> Start an instant meeting</button>
                  <button role="menuitem" onClick={createForLater}><Link2 size={18} /> Create a meeting for later</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); setModal({ type: "schedule" }); }}>
                    <CalendarPlus size={18} /> Schedule a meeting
                  </button>
                </div>
              )}
            </div>

            <form className="join-form" onSubmit={join}>
              <div className="input-icon">
                <Keyboard size={18} />
                <input
                  value={joinValue}
                  onChange={(e) => { setJoinValue(e.target.value); setJoinError(""); }}
                  placeholder="Enter a code or link"
                  aria-label="Meeting code or link"
                />
              </div>
              <button className="btn btn-ghost" disabled={!joinValue.trim()}>Join</button>
            </form>
          </div>
          {joinError && <p className="form-error">{joinError}</p>}
        </section>

        <section className="home-list" aria-label="Your meetings">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={listTab === "upcoming"} onClick={() => setListTab("upcoming")}>Upcoming</button>
            <button role="tab" aria-selected={listTab === "past"} onClick={() => setListTab("past")}>Past meetings</button>
          </div>
          {listTab === "upcoming" &&
            (meetings.length === 0 ? (
              <p className="muted empty">
                Meetings you create or schedule appear here, so you can start them or copy the link later.
              </p>
            ) : (
              <ul className="meeting-list">
                {meetings.map((m) => (
                  <MeetingRow key={m.code} meeting={m} onStart={() => navigate(`/${m.code}`)} onDelete={() => remove(m.code)} />
                ))}
              </ul>
            ))}
          {listTab === "past" &&
            (pastMeetings.length === 0 ? (
              <p className="muted empty">After people join one of your meetings, its attendance report appears here.</p>
            ) : (
              <ul className="meeting-list">
                {pastMeetings.map((m) => (
                  <li key={m.code} className="meeting-row">
                    <div className="meeting-when">
                      <strong>{new Date(m.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
                      <span>{m.is_active ? "Link open" : "Ended"}</span>
                    </div>
                    <div className="meeting-body">
                      <strong>{m.title || "Untitled meeting"}</strong>
                      <span className="muted">{m.code}</span>
                    </div>
                    <div className="meeting-row-actions">
                      <button className="btn btn-small btn-ghost" onClick={() => navigate(`/report/${m.code}`)}>
                        <ClipboardList size={16} /> Attendance
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </main>

      {modal?.type === "link" && <LinkModal meeting={modal.meeting} onClose={() => setModal(null)} />}
      {modal?.type === "schedule" && (
        <ScheduleModal
          onClose={() => setModal(null)}
          onCreate={async (body) => {
            const m = await createMeeting(body);
            loadMeetings();
            setModal({ type: "link", meeting: m });
          }}
        />
      )}
    </div>
  );
}

function MeetingRow({ meeting, onStart, onDelete }) {
  const when = meeting.scheduled_for ? new Date(meeting.scheduled_for) : null;
  return (
    <li className="meeting-row">
      <div className="meeting-when">
        {when ? (
          <>
            <strong>{when.toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
            <span>{when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          </>
        ) : (
          <span className="muted">Any time</span>
        )}
      </div>
      <div className="meeting-body">
        <strong>{meeting.title || "Untitled meeting"}</strong>
        <span className="muted">{meeting.code}</span>
      </div>
      <div className="meeting-row-actions">
        <CopyButton text={meetingLink(meeting.code)} />
        <button className="icon-btn-light" onClick={onDelete} title="Delete meeting" aria-label="Delete meeting">
          <Trash2 size={18} />
        </button>
        <button className="btn btn-small btn-primary" onClick={onStart}>Start</button>
      </div>
    </li>
  );
}

export function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  if (label) {
    return (
      <button className="btn btn-ghost btn-small" onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : label}
      </button>
    );
  }
  return (
    <button className="icon-btn-light" onClick={copy} title="Copy link" aria-label="Copy meeting link">
      {copied ? <Check size={18} /> : <Copy size={18} />}
    </button>
  );
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn-light" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LinkModal({ meeting, onClose }) {
  const link = meetingLink(meeting.code);
  return (
    <Modal title="Here's your meeting link" onClose={onClose}>
      <p className="muted">Send this to people you want to meet with. Save it so you can use it later, too.</p>
      <div className="link-box">
        <span>{link}</span>
        <CopyButton text={link} />
      </div>
    </Modal>
  );
}

function ScheduleModal({ onClose, onCreate }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [approval, setApproval] = useState(true);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    try {
      await onCreate({
        title,
        scheduled_for: when ? new Date(when).toISOString() : null,
        require_approval: approval,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <Modal title="Schedule a meeting" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekly project review" required />
        </label>
        <label>
          Date and time
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </label>
        <label className="check">
          <input type="checkbox" checked={approval} onChange={(e) => setApproval(e.target.checked)} />
          Guests must ask to join, and I admit them
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Schedule</button>
        </div>
      </form>
    </Modal>
  );
}
