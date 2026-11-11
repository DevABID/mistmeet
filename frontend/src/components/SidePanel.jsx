import { useEffect, useRef, useState } from "react";
import { ClipboardList, Download, FileText, Hand, Mic, MicOff, Paperclip, Send, Upload, UserX, X } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { CopyButton } from "../pages/Home.jsx";
import { chatFileUrl, meetingLink } from "../api.js";

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

function formatBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const URL_RE = /(https?:\/\/[^\s]+)/g;
function Linkified({ text }) {
  return text.split(URL_RE).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    ) : (
      part
    )
  );
}

function Attachment({ file }) {
  const view = chatFileUrl(file.url);
  const download = chatFileUrl(file.url, true);
  if (file.is_image) {
    return (
      <div className="chat-image">
        <a href={view} target="_blank" rel="noopener noreferrer" title="Open full size">
          <img src={view} alt={file.name} loading="lazy" />
        </a>
        <div className="chat-image-meta">
          <span>{file.name}</span>
          <a href={download} aria-label={`Download ${file.name}`} title="Download"><Download size={15} /></a>
        </div>
      </div>
    );
  }
  return (
    <a className="chat-file" href={download} title={`Download ${file.name}`}>
      <span className="chat-file-icon"><FileText size={20} /></span>
      <span className="chat-file-text">
        <strong>{file.name}</strong>
        <span className="muted small">{formatBytes(file.size)}</span>
      </span>
      <Download size={18} />
    </a>
  );
}

let pendingSeq = 0;

function ChatPanel({ meeting }) {
  const { messages, selfId, fileLimitMb } = meeting;
  const [text, setText] = useState("");
  const [pending, setPending] = useState([]); // {id, file, preview, status, progress, error}
  const [dragging, setDragging] = useState(false);
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Free image previews when the panel closes.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => () => pendingRef.current.forEach((p) => p.preview && URL.revokeObjectURL(p.preview)), []);

  const update = (id, changes) => setPending((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  const remove = (id) =>
    setPending((list) => {
      const item = list.find((p) => p.id === id);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return list.filter((p) => p.id !== id);
    });

  function addFiles(fileList) {
    const limit = fileLimitMb * 1024 * 1024;
    const items = [...fileList].map((original) => {
      let file = original;
      // Pasted screenshots all arrive as "image.png"; give them a useful name.
      if (/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) || !file.name) {
        const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/:/g, ".");
        file = new File([file], `Pasted image ${stamp}.${ext}`, { type: file.type });
      }
      const tooBig = file.size > limit;
      return {
        id: ++pendingSeq,
        file,
        preview: file.type.startsWith("image/") && !tooBig ? URL.createObjectURL(file) : null,
        status: tooBig ? "error" : "ready",
        progress: 0,
        error: tooBig ? `Larger than ${fileLimitMb} MB` : "",
      };
    });
    setPending((list) => [...list, ...items].slice(0, 10));
  }

  const onPaste = (e) => {
    const files = e.clipboardData?.files;
    if (files && files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDragEnter = (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  async function submit(e) {
    e.preventDefault();
    const body = text.trim();
    const queue = pending.filter((p) => p.status === "ready");
    if (!body && !queue.length) return;
    setText("");

    if (!queue.length) {
      meeting.sendChat(body);
      return;
    }
    let caption = body; // the message text travels with the first file
    for (const item of queue) {
      update(item.id, { status: "uploading", progress: 0, error: "" });
      try {
        await meeting.uploadChatFile(item.file, caption, (progress) => update(item.id, { progress }));
        caption = "";
        remove(item.id);
      } catch (err) {
        update(item.id, { status: "error", error: err.message, retryable: true });
      }
    }
    if (caption) setText(caption);
  }

  const busy = pending.some((p) => p.status === "uploading");
  const canSend = !busy && (text.trim() || pending.some((p) => p.status === "ready"));

  return (
    <div
      className={`chat-panel ${dragging ? "is-dragging" : ""}`}
      onPaste={onPaste}
      onDragEnter={onDragEnter}
      onDragOver={(e) => [...(e.dataTransfer?.types || [])].includes("Files") && e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <p className="panel-note">
        Messages and files are visible to everyone in the call and are saved with this meeting.
      </p>
      <div className="panel-scroll chat-list">
        {messages.length === 0 && (
          <p className="muted empty">No messages yet. Send a note, paste a screenshot, or drop a file here.</p>
        )}
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
              {m.text && <p><Linkified text={m.text} /></p>}
              {m.file && <Attachment file={m.file} />}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {pending.length > 0 && (
        <ul className="pending-files" aria-label="Files to send">
          {pending.map((p) => (
            <li key={p.id} className={`pending-file ${p.status === "error" ? "has-error" : ""}`}>
              {p.preview ? <img src={p.preview} alt="" /> : <span className="chat-file-icon"><FileText size={18} /></span>}
              <span className="pending-text">
                <span className="pending-name">{p.file.name}</span>
                <span className="small">
                  {p.status === "error" ? p.error : p.status === "uploading" ? `Sending… ${Math.round(p.progress * 100)}%` : formatBytes(p.file.size)}
                </span>
                {p.status === "uploading" && (
                  <span className="pending-bar"><span style={{ width: `${Math.round(p.progress * 100)}%` }} /></span>
                )}
              </span>
              {p.status === "error" && p.retryable && (
                <button type="button" className="link-btn small" onClick={() => update(p.id, { status: "ready", error: "" })}>Retry</button>
              )}
              {p.status !== "uploading" && (
                <button type="button" className="icon-btn-light" onClick={() => remove(p.id)} aria-label={`Remove ${p.file.name}`}>
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="chat-form" onSubmit={submit}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="icon-btn-light"
          onClick={() => fileInputRef.current?.click()}
          aria-label={`Attach files (up to ${fileLimitMb} MB each)`}
          title={`Attach files (up to ${fileLimitMb} MB each)`}
        >
          <Paperclip size={18} />
        </button>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={pending.length ? "Add a message (optional)" : "Send a message"}
          maxLength={2000}
          aria-label="Message"
        />
        <button className="icon-btn-light" disabled={!canSend} aria-label="Send">
          <Send size={18} />
        </button>
      </form>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <Upload size={28} />
          <span>Drop files to share with everyone</span>
        </div>
      )}
    </div>
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
      <p className="panel-credit muted small">
        MIST Meet, developed by{" "}
        <a href="https://www.linkedin.com/in/abidurrahmanabid/" target="_blank" rel="noopener noreferrer">Abidur Rahman</a>
      </p>
    </div>
  );
}
