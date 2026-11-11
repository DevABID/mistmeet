import { useEffect, useRef, useState } from "react";
import { ClipboardList, Hand, Mic, MicOff, Send, UserX, X } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { CopyButton } from "../pages/Home.jsx";
import { meetingLink } from "../api.js";

const TITLES = { people: "People", chat: "In-call messages", info: "Meeting details" };

export default function SidePanel({ tab, onClose, meeting, info, peerList }) {
  return (
    <aside className="side-panel" aria-label={TITLES[tab]}>
      <div className="panel-head">
        <h2>{TITLES[tab]}</h2>
        <button className="icon-btn-light" onClick={onClose} aria-label="Close panel"><X size={20} /></button>
      </div>
      {tab === "people" && <PeoplePanel meeting={meeting} peerList={peerList} />}
      {tab === "chat" && <ChatPanel meeting={meeting} />}
      {tab === "info" && <InfoPanel info={info} isHost={meeting.isHost} />}
    </aside>
  );
}

function PeoplePanel({ meeting, peerList }) {
  const { isHost, joinRequests, audioOn, hand } = meeting;
  const raised = peerList.filter((p) => p.hand);

  return (
    <div className="panel-scroll">
      {isHost && joinRequests.length > 0 && (
        <section className="people-section">
          <div className="section-head">
            <h3>Waiting to join ({joinRequests.length})</h3>
            {joinRequests.length > 1 && (
              <button className="link-btn" onClick={() => joinRequests.forEach((r) => meeting.admit(r.peer_id))}>
                Admit all
              </button>
            )}
          </div>
          {joinRequests.map((r) => (
            <div key={r.peer_id} className="person">
              <Avatar name={r.name} size={36} />
              <div className="person-name">{r.name}</div>
              <button className="btn btn-small btn-ghost" onClick={() => meeting.deny(r.peer_id)}>Deny</button>
              <button className="btn btn-small btn-primary" onClick={() => meeting.admit(r.peer_id)}>Admit</button>
            </div>
          ))}
        </section>
      )}

      {raised.length > 0 && (
        <section className="people-section">
          <h3>Raised hands</h3>
          {raised.map((p) => (
            <div key={p.peer_id} className="person">
              <Avatar name={p.name} size={36} />
              <div className="person-name">{p.name}</div>
              <Hand size={18} className="amber" aria-label="Hand raised" />
            </div>
          ))}
        </section>
      )}

      <section className="people-section">
        <div className="section-head">
          <h3>In the meeting ({peerList.length + 1})</h3>
          {isHost && (
            <a className="link-btn small" href={`/report/${meeting.code}`} target="_blank" rel="noreferrer">Attendance</a>
          )}
        </div>
        <div className="person">
          <Avatar name={meeting.selfName || "You"} size={36} />
          <div className="person-name">
            You
            {isHost && <span className="muted small">Meeting host</span>}
          </div>
          {hand && <Hand size={18} className="amber" aria-label="Hand raised" />}
          {audioOn ? <Mic size={18} className="muted" /> : <MicOff size={18} className="muted" />}
        </div>
        {peerList.map((p) => (
          <div key={p.peer_id} className="person">
            <Avatar name={p.name} size={36} />
            <div className="person-name">
              {p.name}
              {p.is_host && <span className="muted small">Meeting host</span>}
            </div>
            {p.hand && <Hand size={18} className="amber" aria-label="Hand raised" />}
            {isHost && p.audio ? (
              <button className="icon-btn-light" onClick={() => meeting.muteParticipant(p.peer_id)} title={`Mute ${p.name}`} aria-label={`Mute ${p.name}`}>
                <Mic size={18} />
              </button>
            ) : p.audio ? (
              <Mic size={18} className="muted" />
            ) : (
              <MicOff size={18} className="muted" aria-label="Muted" />
            )}
            {isHost && !p.is_host && (
              <button className="icon-btn-light" onClick={() => meeting.removeParticipant(p.peer_id)} title={`Remove ${p.name}`} aria-label={`Remove ${p.name}`}>
                <UserX size={18} />
              </button>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function ChatPanel({ meeting }) {
  const { messages, selfId } = meeting;
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const submit = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    meeting.sendChat(text.trim());
    setText("");
  };

  return (
    <>
      <p className="panel-note">Messages are visible to everyone in the call and are saved with this meeting.</p>
      <div className="panel-scroll chat-list">
        {messages.length === 0 && <p className="muted empty">No messages yet. Share a link or a quick note with the group.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const grouped = prev && prev.peer_id === m.peer_id && new Date(m.created_at) - new Date(prev.created_at) < 60000;
          return (
            <div key={m.id} className="chat-msg">
              {!grouped && (
                <div className="chat-head">
                  <strong>{m.peer_id === selfId ? "You" : m.name}</strong>
                  <span className="muted small">
                    {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                  </span>
                </div>
              )}
              <p>{m.text}</p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Send a message" maxLength={2000} aria-label="Message" />
        <button className="icon-btn-light" disabled={!text.trim()} aria-label="Send message"><Send size={18} /></button>
      </form>
    </>
  );
}

function InfoPanel({ info, isHost }) {
  const link = meetingLink(info.code);
  return (
    <div className="panel-scroll">
      <h3>Joining info</h3>
      <p className="info-link">{link}</p>
      <CopyButton text={link} label="Copy joining info" />
      <dl className="info-list">
        <dt>Meeting code</dt>
        <dd>{info.code}</dd>
        <dt>Host</dt>
        <dd>{info.host_name}</dd>
        <dt>Guests</dt>
        <dd>{info.require_approval ? "Must ask to join" : "Can join directly with the link"}</dd>
      </dl>
      {isHost && (
        <div className="info-attendance">
          <h3>Attendance</h3>
          <p className="muted small">See who joined, when, and for how long. Updates live while the call runs.</p>
          {/* Opens in a new tab so the host stays in the call. */}
          <a className="btn btn-ghost btn-small" href={`/report/${info.code}`} target="_blank" rel="noreferrer">
            <ClipboardList size={16} /> Open attendance report
          </a>
        </div>
      )}
    </div>
  );
}
