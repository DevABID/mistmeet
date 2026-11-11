import { useState } from "react";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";
import Footer from "./Footer.jsx";
import Logo from "./Logo.jsx";
import VideoTile from "./VideoTile.jsx";

export default function Lobby({ meeting, info, defaultName }) {
  const [name, setName] = useState(defaultName);
  const { status, audioOn, videoOn, selfStream, devices, selected, mediaError } = meeting;
  const waiting = status === "waiting";
  const connecting = status === "connecting";
  const needsApproval = info.require_approval && !info.is_host;

  const others = info.participant_count;
  const presence =
    others === 0 ? "No one else is here" : others === 1 ? "1 person is in this call" : `${others} people are in this call`;

  return (
    <div className="lobby">
      <header className="home-header"><Logo /></header>
      <main className="lobby-main">
        <div className="lobby-preview">
          <div className="preview-frame">
            <VideoTile stream={selfStream} name={name || defaultName} isSelf mirror audioOn={audioOn} showVideo={videoOn} />
            <div className="preview-controls">
              <button
                className={`round-btn ${audioOn ? "" : "is-off"}`}
                onClick={meeting.toggleAudio}
                aria-label={audioOn ? "Turn off microphone" : "Turn on microphone"}
                aria-pressed={!audioOn}
              >
                {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
              </button>
              <button
                className={`round-btn ${videoOn ? "" : "is-off"}`}
                onClick={meeting.toggleVideo}
                aria-label={videoOn ? "Turn off camera" : "Turn on camera"}
                aria-pressed={!videoOn}
              >
                {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
            </div>
          </div>
          {mediaError && <p className="lobby-warning" role="status">{mediaError}</p>}
          <div className="device-row">
            <DeviceSelect label="Microphone" items={devices.audioinput} value={selected.audioinput} onChange={(id) => meeting.switchDevice("audioinput", id)} />
            <DeviceSelect label="Camera" items={devices.videoinput} value={selected.videoinput} onChange={(id) => meeting.switchDevice("videoinput", id)} />
          </div>
        </div>

        <div className="lobby-side">
          {waiting ? (
            <>
              <h1>Asking to be let in…</h1>
              <p className="muted">You'll join the call when someone lets you in.</p>
              <div className="spinner spinner-inline" />
              <button className="btn btn-ghost" onClick={meeting.leave}>Cancel request</button>
            </>
          ) : (
            <>
              <h1>{info.title || "Ready to join?"}</h1>
              <p className="muted">{presence}</p>
              <label className="lobby-name">
                Your name
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              </label>
              <button
                className="btn btn-primary btn-wide"
                disabled={connecting || !name.trim()}
                onClick={() => meeting.join(name.trim())}
              >
                {connecting ? "Joining…" : needsApproval ? "Ask to join" : "Join now"}
              </button>
              <p className="muted small">Meeting code: {info.code} • Host: {info.host_name}</p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function DeviceSelect({ label, items, value, onChange }) {
  if (!items.length) return null;
  return (
    <label className="device-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {items.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>
    </label>
  );
}
