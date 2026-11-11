import { useEffect, useRef } from "react";
import { Hand, MicOff, Pin, PinOff } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { useSpeaking } from "../hooks/useSpeaking.js";

export default function VideoTile({
  stream,
  name,
  label,
  isSelf = false,
  audioOn = true,
  showVideo = true,
  mirror = false,
  screen = false,
  hand = false,
  pinned = false,
  onPin,
  compact = false,
}) {
  const videoRef = useRef(null);
  const speaking = useSpeaking(screen ? null : stream, audioOn);

  useEffect(() => {
    const el = videoRef.current;
    if (el && el.srcObject !== stream) el.srcObject = stream || null;
  }, [stream]);

  return (
    <div
      className={[
        "tile",
        speaking && "is-speaking",
        screen && "is-screen",
        compact && "is-compact",
      ].filter(Boolean).join(" ")}
    >
      {/* The element stays mounted even with the camera off so remote audio keeps playing. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={mirror ? "mirror" : ""}
        style={{ visibility: showVideo ? "visible" : "hidden" }}
      />
      {!showVideo && (
        <div className="tile-avatar">
          <Avatar name={name} size={compact ? 48 : 88} />
        </div>
      )}

      {hand && (
        <div className="tile-hand" title="Hand raised">
          <Hand size={16} />
        </div>
      )}

      <div className="tile-meta">
        {!audioOn && !screen && <MicOff size={14} aria-label="Muted" />}
        <span>{label || name}</span>
      </div>

      {onPin && (
        <button className="tile-pin" onClick={onPin} aria-label={pinned ? "Unpin" : "Pin to main view"}>
          {pinned ? <PinOff size={18} /> : <Pin size={18} />}
        </button>
      )}
    </div>
  );
}
