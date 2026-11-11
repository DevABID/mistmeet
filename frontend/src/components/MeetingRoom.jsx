import { useEffect, useMemo, useRef, useState } from "react";
import {
  Hand, Info, MessageSquare, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Smile, Users, Video, VideoOff,
} from "lucide-react";
import VideoTile from "./VideoTile.jsx";
import SidePanel from "./SidePanel.jsx";
import { useClock } from "../hooks/useClock.js";

const EMOJIS = ["💖", "👍", "🎉", "👏", "😂", "😮", "😢", "🤔", "👎"];

function gridColumns(n) {
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

export default function MeetingRoom({ meeting, info }) {
  const {
    peers, selfId, isHost, audioOn, videoOn, sharing, hand, selfStream, screenStream,
    messages, joinRequests, reactions, notices,
  } = meeting;
  const now = useClock(15000);
  const [panel, setPanel] = useState(null); // 'people' | 'chat' | 'info'
  const [pinned, setPinned] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [readCount, setReadCount] = useState(messages.length);
  const peerList = Object.values(peers);

  // ----- tiles
  const tiles = useMemo(() => {
    const list = [
      {
        id: "self",
        stream: selfStream,
        name: "You",
        isSelf: true,
        mirror: true,
        audioOn,
        showVideo: videoOn,
        hand,
      },
    ];
    if (sharing && screenStream) {
      list.push({ id: "self-screen", stream: screenStream, name: "You", label: "You are presenting", isSelf: true, screen: true, showVideo: true, audioOn: true });
    }
    peerList.forEach((p) =>
      list.push({
        id: p.peer_id,
        stream: p.stream,
        name: p.name,
        label: p.sharing ? `${p.name} is presenting` : p.name,
        audioOn: p.audio,
        showVideo: Boolean(p.stream) && (p.video || p.sharing),
        screen: p.sharing,
        hand: p.hand,
      })
    );
    return list;
  }, [peers, selfStream, screenStream, sharing, audioOn, videoOn, hand]);

  const presenter = tiles.find((t) => t.screen && t.id !== "self-screen")?.id || (sharing ? "self-screen" : null);
  const spotlightId = tiles.some((t) => t.id === pinned) ? pinned : presenter;
  const spotlight = tiles.find((t) => t.id === spotlightId);
  const others = spotlight ? tiles.filter((t) => t.id !== spotlightId) : tiles;

  // ----- chat unread
  useEffect(() => {
    if (panel === "chat") setReadCount(messages.length);
  }, [panel, messages.length]);
  const unread = panel === "chat" ? 0 : Math.max(0, messages.length - readCount);

  // ----- keyboard shortcuts (same as most meeting apps)
  const actionsRef = useRef(meeting);
  actionsRef.current = meeting;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "d") { e.preventDefault(); actionsRef.current.toggleAudio(); }
      if (key === "e") { e.preventDefault(); actionsRef.current.toggleVideo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const togglePanel = (name) => setPanel((p) => (p === name ? null : name));
  const pinToggle = (id) => setPinned((p) => (p === id ? null : id));

  const renderTile = (t, compact = false) => (
    <VideoTile
      key={t.id}
      {...t}
      compact={compact}
      pinned={pinned === t.id}
      onPin={() => pinToggle(t.id)}
    />
  );

  return (
    <div className="room">
      <div className={`room-body ${panel ? "has-panel" : ""}`}>
        <div className="stage">
          {spotlight ? (
            <div className="spotlight-layout">
              <div className="spotlight-main">{renderTile(spotlight)}</div>
              {others.length > 0 && <div className="spotlight-strip">{others.map((t) => renderTile(t, true))}</div>}
            </div>
          ) : (
            <div
              className="grid-layout"
              style={{
                gridTemplateColumns: `repeat(${gridColumns(tiles.length)}, minmax(0, 1fr))`,
              }}
            >
              {tiles.map((t) => renderTile(t))}
            </div>
          )}

          <div className="reaction-layer" aria-hidden="true">
            {reactions.map((r) => (
              <div key={r.id} className="reaction" style={{ left: `${r.left}%` }}>
                <span className="reaction-emoji">{r.emoji}</span>
                <span className="reaction-name">{r.name}</span>
              </div>
            ))}
          </div>
        </div>

        {panel && (
          <SidePanel
            tab={panel}
            onClose={() => setPanel(null)}
            meeting={meeting}
            info={info}
            peerList={peerList}
          />
        )}
      </div>

      {/* host: join requests */}
      {isHost && joinRequests.length > 0 && panel !== "people" && (
        <div className="request-stack" role="region" aria-label="Join requests">
          {joinRequests.slice(0, 3).map((r) => (
            <div key={r.peer_id} className="request-card">
              <span><strong>{r.name}</strong> wants to join this call</span>
              <div>
                <button className="btn btn-small btn-ghost-dark" onClick={() => meeting.deny(r.peer_id)}>Deny</button>
                <button className="btn btn-small btn-primary" onClick={() => meeting.admit(r.peer_id)}>Admit</button>
              </div>
            </div>
          ))}
          {joinRequests.length > 3 && (
            <button className="request-more" onClick={() => setPanel("people")}>
              View all {joinRequests.length} requests
            </button>
          )}
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {notices.map((n) => <div key={n.id} className="toast">{n.text}</div>)}
      </div>

      <footer className="control-bar">
        <div className="bar-left">
          <span>{now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
          <span className="bar-sep" />
          <span className="bar-code">{info.title || info.code}</span>
        </div>

        <div className="bar-center">
          <CtrlButton on={audioOn} onClick={meeting.toggleAudio} label={audioOn ? "Turn off microphone (Ctrl+D)" : "Turn on microphone (Ctrl+D)"}>
            {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
          </CtrlButton>
          <CtrlButton on={videoOn} onClick={meeting.toggleVideo} label={videoOn ? "Turn off camera (Ctrl+E)" : "Turn on camera (Ctrl+E)"}>
            {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
          </CtrlButton>
          <CtrlButton
            on
            active={sharing}
            onClick={meeting.toggleShare}
            label={sharing ? "Stop presenting" : "Present now"}
            disabled={!sharing && presenter && presenter !== "self-screen"}
            hideMobile
          >
            {sharing ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
          </CtrlButton>
          <div className="menu-anchor">
            <CtrlButton on active={emojiOpen} onClick={() => setEmojiOpen((o) => !o)} label="Send a reaction">
              <Smile size={22} />
            </CtrlButton>
            {emojiOpen && (
              <div className="emoji-bar" role="menu">
                {EMOJIS.map((e) => (
                  <button key={e} role="menuitem" onClick={() => meeting.sendReaction(e)} aria-label={`React ${e}`}>{e}</button>
                ))}
              </div>
            )}
          </div>
          <CtrlButton on active={hand} onClick={meeting.toggleHand} label={hand ? "Lower hand" : "Raise hand"}>
            <Hand size={22} />
          </CtrlButton>
          <div className="menu-anchor">
            <button
              className="leave-btn"
              onClick={() => (isHost ? setLeaveOpen((o) => !o) : meeting.leave())}
              aria-label="Leave call"
              title="Leave call"
            >
              <PhoneOff size={22} />
            </button>
            {leaveOpen && (
              <div className="menu menu-up">
                <button onClick={meeting.leave}>Leave call</button>
                <button className="danger" onClick={meeting.endForAll}>End call for everyone</button>
              </div>
            )}
          </div>
        </div>

        <div className="bar-right">
          <SideButton active={panel === "info"} onClick={() => togglePanel("info")} label="Meeting details"><Info size={22} /></SideButton>
          <SideButton active={panel === "people"} onClick={() => togglePanel("people")} label="People" badge={peerList.length + 1} alert={isHost && joinRequests.length > 0}>
            <Users size={22} />
          </SideButton>
          <SideButton active={panel === "chat"} onClick={() => togglePanel("chat")} label="Chat with everyone" alert={unread > 0}>
            <MessageSquare size={22} />
          </SideButton>
        </div>
      </footer>
    </div>
  );
}

function CtrlButton({ on, active, onClick, label, children, disabled, hideMobile }) {
  return (
    <button
      className={`ctrl-btn ${on ? "" : "is-off"} ${active ? "is-active" : ""} ${hideMobile ? "hide-mobile" : ""}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function SideButton({ active, onClick, label, children, badge, alert }) {
  return (
    <button className={`side-btn ${active ? "is-active" : ""}`} onClick={onClick} aria-label={label} title={label}>
      {children}
      {badge != null && <span className="side-count">{badge}</span>}
      {alert && <span className="side-dot" />}
    </button>
  );
}
