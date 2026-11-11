import { useEffect, useRef, useState } from "react";
import { api, uploadWithProgress, wsUrl } from "../api.js";
import { getAudioContext } from "./useSpeaking.js";

/*
 * Everything a meeting needs on the client:
 *  - local camera / microphone (with device switching)
 *  - a WebSocket to Django Channels for signaling and room events
 *  - one RTCPeerConnection per remote participant (full mesh)
 *
 * Mesh works well for small and medium calls (roughly up to 6–8 people with
 * video). For larger rooms, swap the peer connections for an SFU such as
 * LiveKit, mediasoup or Janus; the signaling/UI layer can stay the same.
 *
 * Each connection always has exactly one audio and one video transceiver, so
 * muting, turning the camera off/on, switching devices and screen sharing are
 * all done with `replaceTrack` and never need renegotiation.
 */

const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
const FALLBACK_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

async function acquire(kind, deviceId) {
  const base = kind === "audio" ? AUDIO : VIDEO;
  const constraints = { [kind]: deviceId ? { ...base, deviceId: { exact: deviceId } } : base };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return kind === "audio" ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
}

const senderFor = (pc, kind) =>
  pc.getTransceivers().find((t) => t.receiver.track?.kind === kind)?.sender;

export function useMeeting(code) {
  // ---- public state
  const [status, setStatusState] = useState("lobby");
  const [errorReason, setErrorReason] = useState(null);
  const [selfId, setSelfId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [peers, setPeers] = useState({});
  const [messages, setMessages] = useState([]);
  const [joinRequests, setJoinRequests] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [notices, setNotices] = useState([]);

  const [audioOn, setAudioOnState] = useState(false);
  const [videoOn, setVideoOnState] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [hand, setHand] = useState(false);
  const [selfStream, setSelfStream] = useState(null);
  const [screenStream, setScreenStream] = useState(null);
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [], audiooutput: [] });
  const [selected, setSelected] = useState({ audioinput: "", videoinput: "" });
  const [mediaError, setMediaError] = useState("");
  const [selfName, setSelfName] = useState("");
  const [fileLimitMb, setFileLimitMb] = useState(10);
  const [wbOpen, setWbOpen] = useState(false);
  const [wbUnseen, setWbUnseen] = useState(false);
  const wbOpenRef = useRef(false);
  const wbListenersRef = useRef(new Set());

  // ---- refs (read inside async callbacks without stale closures)
  const wsRef = useRef(null);
  const pcsRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const remoteTracksRef = useRef(new Map());
  const audioTrackRef = useRef(null);
  const camTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const iceRef = useRef(FALLBACK_ICE);
  const selfIdRef = useRef(null);
  const statusRef = useRef("lobby");
  const audioOnRef = useRef(false);
  const videoOnRef = useRef(false);
  const selectedRef = useRef(selected);
  const peersRef = useRef({});
  const mediaGenRef = useRef(0);
  const handlerRef = useRef(() => {});
  const pingRef = useRef(0);

  peersRef.current = peers;
  selectedRef.current = selected;

  const setStatus = (s) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const setAudioOn = (v) => {
    audioOnRef.current = v;
    setAudioOnState(v);
  };
  const setVideoOn = (v) => {
    videoOnRef.current = v;
    setVideoOnState(v);
  };

  const setWhiteboardOpen = (open) => {
    wbOpenRef.current = open;
    setWbOpen(open);
    if (open) setWbUnseen(false);
  };

  const notify = (text) => {
    const id = Math.random().toString(36).slice(2);
    setNotices((n) => [...n.slice(-3), { id, text }]);
    setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 4000);
  };

  const send = (payload) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  };

  const refreshSelfStream = () => {
    const tracks = [audioTrackRef.current, camTrackRef.current].filter((t) => t && t.readyState === "live");
    setSelfStream(tracks.length ? new MediaStream(tracks) : null);
  };

  const outgoingVideo = () => screenTrackRef.current || camTrackRef.current || null;

  const replaceSenders = (kind, track) => {
    pcsRef.current.forEach((pc) => {
      senderFor(pc, kind)?.replaceTrack(track).catch(() => {});
    });
  };

  // =================================================================== local media

  async function loadDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const grouped = { audioinput: [], videoinput: [], audiooutput: [] };
      list.forEach((d) => grouped[d.kind]?.push({ id: d.deviceId, label: d.label || d.kind }));
      setDevices(grouped);
      setSelected({
        audioinput: audioTrackRef.current?.getSettings().deviceId || grouped.audioinput[0]?.id || "",
        videoinput: camTrackRef.current?.getSettings().deviceId || grouped.videoinput[0]?.id || "",
      });
    } catch {
      /* enumerateDevices can fail on insecure origins */
    }
  }

  async function initMedia() {
    const gen = ++mediaGenRef.current;
    let audio = null;
    let video = null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO, video: VIDEO });
      audio = s.getAudioTracks()[0] || null;
      video = s.getVideoTracks()[0] || null;
    } catch {
      audio = await acquire("audio").catch(() => null);
      video = await acquire("video").catch(() => null);
    }
    if (gen !== mediaGenRef.current) {
      // A newer init or a teardown happened while we waited for permission.
      audio?.stop();
      video?.stop();
      return;
    }
    audioTrackRef.current = audio;
    camTrackRef.current = video;
    setAudioOn(Boolean(audio));
    setVideoOn(Boolean(video));
    setMediaError(
      !audio && !video
        ? "Camera and microphone are blocked. Allow access in your browser's site settings, then reload."
        : !audio
        ? "No microphone found. Others won't hear you."
        : !video
        ? "No camera found. Others will see your initials."
        : ""
    );
    refreshSelfStream();
    loadDevices();
  }

  function stopMedia() {
    mediaGenRef.current++;
    [audioTrackRef, camTrackRef, screenTrackRef].forEach((ref) => {
      ref.current?.stop();
      ref.current = null;
    });
    setSelfStream(null);
    setScreenStream(null);
    setSharing(false);
  }

  async function setAudio(next) {
    if (next && !audioTrackRef.current) {
      try {
        audioTrackRef.current = await acquire("audio", selectedRef.current.audioinput);
        replaceSenders("audio", audioTrackRef.current);
        refreshSelfStream();
      } catch {
        notify("Your microphone isn't available. Check your browser permissions.");
        return;
      }
    }
    if (audioTrackRef.current) audioTrackRef.current.enabled = next;
    setAudioOn(next);
    send({ type: "state", audio: next });
  }

  async function setVideo(next) {
    if (next) {
      try {
        const track = await acquire("video", selectedRef.current.videoinput);
        camTrackRef.current = track;
        if (!screenTrackRef.current) replaceSenders("video", track);
      } catch {
        notify("Your camera isn't available. It may be in use by another app.");
        return;
      }
    } else {
      // Stopping the track (not just disabling it) turns the camera light off.
      camTrackRef.current?.stop();
      camTrackRef.current = null;
      if (!screenTrackRef.current) replaceSenders("video", null);
    }
    setVideoOn(next);
    refreshSelfStream();
    send({ type: "state", video: next });
  }

  async function switchDevice(kind, deviceId) {
    setSelected((s) => ({ ...s, [kind]: deviceId }));
    selectedRef.current = { ...selectedRef.current, [kind]: deviceId };
    try {
      if (kind === "audioinput" && audioTrackRef.current) {
        const track = await acquire("audio", deviceId);
        track.enabled = audioOnRef.current;
        audioTrackRef.current.stop();
        audioTrackRef.current = track;
        replaceSenders("audio", track);
      }
      if (kind === "videoinput" && videoOnRef.current) {
        camTrackRef.current?.stop();
        const track = await acquire("video", deviceId);
        camTrackRef.current = track;
        if (!screenTrackRef.current) replaceSenders("video", track);
      }
      refreshSelfStream();
    } catch {
      notify("Couldn't switch to that device.");
    }
  }

  async function startShare() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      const track = display.getVideoTracks()[0];
      track.contentHint = "detail";
      track.onended = () => stopShare();
      screenTrackRef.current = track;
      replaceSenders("video", track);
      setScreenStream(new MediaStream([track]));
      setSharing(true);
      send({ type: "state", sharing: true });
    } catch {
      /* user cancelled the picker */
    }
  }

  function stopShare() {
    if (!screenTrackRef.current) return;
    screenTrackRef.current.onended = null;
    screenTrackRef.current.stop();
    screenTrackRef.current = null;
    replaceSenders("video", camTrackRef.current);
    setScreenStream(null);
    setSharing(false);
    send({ type: "state", sharing: false });
  }

  // =================================================================== peer connections

  function setPeerTrack(peerId, track) {
    const entry = remoteTracksRef.current.get(peerId) || {};
    entry[track.kind] = track;
    remoteTracksRef.current.set(peerId, entry);
    const stream = new MediaStream([entry.audio, entry.video].filter(Boolean));
    setPeers((p) => ({ ...p, [peerId]: { peer_id: peerId, name: "Guest", ...p[peerId], stream } }));
  }

  function createPC(peerId, isCaller) {
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    pc.__caller = isCaller;
    if (isCaller) {
      pc.addTransceiver(audioTrackRef.current || "audio", { direction: "sendrecv" });
      pc.addTransceiver(outgoingVideo() || "video", { direction: "sendrecv" });
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: "signal", to: peerId, data: { candidate: e.candidate } });
    };
    pc.ontrack = (e) => setPeerTrack(peerId, e.track);
    pc.onconnectionstatechange = async () => {
      if (pc.connectionState === "failed" && pc.__caller) {
        try {
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          send({ type: "signal", to: peerId, data: { sdp: pc.localDescription } });
        } catch {
          /* peer may be gone */
        }
      }
    };
    pcsRef.current.set(peerId, pc);
    return pc;
  }

  function closePeer(peerId) {
    pcsRef.current.get(peerId)?.close();
    pcsRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    remoteTracksRef.current.delete(peerId);
  }

  function closeAllPeers() {
    [...pcsRef.current.keys()].forEach(closePeer);
  }

  async function callPeer(peerId) {
    const pc = createPC(peerId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: "signal", to: peerId, data: { sdp: pc.localDescription } });
  }

  async function flushIce(peerId, pc) {
    const queued = pendingIceRef.current.get(peerId) || [];
    pendingIceRef.current.delete(peerId);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
  }

  async function handleSignal(from, data) {
    if (data.sdp) {
      let pc = pcsRef.current.get(from);
      if (data.sdp.type === "offer") {
        if (pc && pc.signalingState !== "stable") {
          // Both sides offered at once ("glare"): the peer with the smaller id yields.
          const polite = selfIdRef.current < from;
          if (!polite) return;
          closePeer(from);
          pc = null;
        }
        if (!pc) pc = createPC(from, false);
        await pc.setRemoteDescription(data.sdp);
        pc.getTransceivers().forEach((t) => {
          const kind = t.receiver.track?.kind;
          t.direction = "sendrecv";
          t.sender.replaceTrack(kind === "audio" ? audioTrackRef.current : outgoingVideo()).catch(() => {});
        });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "signal", to: from, data: { sdp: pc.localDescription } });
      } else if (pc) {
        await pc.setRemoteDescription(data.sdp);
      }
      if (pc) await flushIce(from, pc);
    } else if (data.candidate) {
      const pc = pcsRef.current.get(from);
      if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else pendingIceRef.current.set(from, [...(pendingIceRef.current.get(from) || []), data.candidate]);
    }
  }

  // =================================================================== room events

  function endSession(finalStatus) {
    clearInterval(pingRef.current);
    setStatus(finalStatus);
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    closeAllPeers();
    stopMedia();
    setPeers({});
    setJoinRequests([]);
    setHand(false);
    setWhiteboardOpen(false);
    setWbUnseen(false);
  }

  const mergeMessages = (incoming) =>
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      return [...prev, ...incoming.filter((m) => !seen.has(m.id))].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
    });

  handlerRef.current = (msg) => {
    // Whiteboard messages go to the open board (if any); the hook only tracks open/unseen.
    if (typeof msg.type === "string" && msg.type.startsWith("wb-")) {
      wbListenersRef.current.forEach((listener) => listener(msg));
      if (msg.type === "wb-show") {
        setWhiteboardOpen(true);
        notify(`${msg.by} is showing the whiteboard`);
      } else if (msg.type === "wb-op" && !wbOpenRef.current) {
        setWbUnseen(true);
      }
      return;
    }
    switch (msg.type) {
      case "error":
        setErrorReason(msg.reason);
        endSession("error");
        break;
      case "waiting":
        setStatus("waiting");
        break;
      case "denied":
        endSession("denied");
        break;
      case "room-state": {
        selfIdRef.current = msg.self_id;
        setSelfId(msg.self_id);
        setIsHost(msg.is_host);
        const map = {};
        msg.peers.forEach((p) => (map[p.peer_id] = { ...p, stream: null }));
        setPeers(map);
        setJoinRequests(msg.waiting || []);
        if (msg.limits?.file_mb) setFileLimitMb(msg.limits.file_mb);
        setStatus("joined");
        api(`/meetings/${code}/messages/`).then(mergeMessages).catch(() => {});
        msg.peers.forEach((p) => callPeer(p.peer_id).catch(() => {}));
        break;
      }
      case "peer-joined":
        setPeers((p) => ({ ...p, [msg.peer.peer_id]: { ...p[msg.peer.peer_id], ...msg.peer } }));
        notify(`${msg.peer.name} joined`);
        break;
      case "peer-left": {
        const name = peersRef.current[msg.peer_id]?.name;
        closePeer(msg.peer_id);
        setPeers((p) => {
          const next = { ...p };
          delete next[msg.peer_id];
          return next;
        });
        if (name) notify(`${name} left`);
        break;
      }
      case "peer-state": {
        const { type, peer_id, ...changes } = msg;
        if (peer_id === selfIdRef.current) break;
        const current = peersRef.current[peer_id];
        if (changes.hand && current && !current.hand) notify(`${current.name} raised a hand`);
        setPeers((p) => (p[peer_id] ? { ...p, [peer_id]: { ...p[peer_id], ...changes } } : p));
        break;
      }
      case "signal":
        handleSignal(msg.from, msg.data).catch((err) => console.warn("Signaling error", err));
        break;
      case "chat":
        mergeMessages([msg]);
        if (msg.file && msg.peer_id !== selfIdRef.current) {
          notify(`${msg.name} shared ${msg.file.is_image ? "an image" : "a file"}`);
        }
        break;
      case "reaction": {
        const id = Math.random().toString(36).slice(2);
        setReactions((r) => [...r.slice(-11), { id, emoji: msg.emoji, name: msg.name, left: 4 + Math.random() * 18 }]);
        setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 4000);
        break;
      }
      case "join-request":
        setJoinRequests((r) => (r.some((x) => x.peer_id === msg.peer_id) ? r : [...r, msg]));
        break;
      case "join-request-cancelled":
      case "join-request-resolved":
        setJoinRequests((r) => r.filter((x) => x.peer_id !== msg.peer_id));
        break;
      case "force-mute":
        if (audioOnRef.current) {
          setAudio(false);
          notify(`${msg.by} muted your microphone`);
        }
        break;
      case "server-error":
        notify(msg.message);
        break;
      case "removed":
        endSession("removed");
        break;
      case "meeting-ended":
        endSession("ended");
        break;
      default:
        break;
    }
  };

  // =================================================================== public actions

  async function join(name) {
    getAudioContext()?.resume();
    setSelfName(name);
    setErrorReason(null);
    setMessages([]);
    setStatus("connecting");
    try {
      const { iceServers } = await api("/ice-servers/");
      iceRef.current = iceServers?.length ? iceServers : FALLBACK_ICE;
    } catch {
      iceRef.current = FALLBACK_ICE;
    }
    const ws = new WebSocket(wsUrl(code));
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", name, audio: audioOnRef.current, video: videoOnRef.current }));
      // Heartbeat: lets the server tell live connections from ones that vanished.
      clearInterval(pingRef.current);
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
      }, 20000);
    };
    ws.onmessage = (e) => handlerRef.current(JSON.parse(e.data));
    ws.onclose = () => {
      if (wsRef.current !== ws) return; // closed on purpose
      if (["connecting", "waiting", "joined"].includes(statusRef.current)) endSession("disconnected");
    };
  }

  const leave = () => endSession("left");
  const backToLobby = () => {
    setStatus("lobby");
    initMedia();
  };

  const toggleHand = () => {
    const next = !hand;
    setHand(next);
    send({ type: "state", hand: next });
  };

  // =================================================================== lifecycle

  useEffect(() => {
    initMedia();
    navigator.mediaDevices?.addEventListener?.("devicechange", loadDevices);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", loadDevices);
      clearInterval(pingRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
      closeAllPeers();
      stopMedia();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return {
    code, status, errorReason, selfId, selfName, isHost, peers, messages, joinRequests, reactions, notices,
    audioOn, videoOn, sharing, hand, selfStream, screenStream, devices, selected, mediaError,
    join, leave, backToLobby, notify,
    toggleAudio: () => setAudio(!audioOnRef.current),
    toggleVideo: () => setVideo(!videoOnRef.current),
    switchDevice,
    toggleShare: () => (screenTrackRef.current ? stopShare() : startShare()),
    toggleHand,
    sendChat: (text) => send({ type: "chat", text }),
    fileLimitMb,
    wbOpen,
    wbUnseen,
    setWhiteboardOpen,
    sendWhiteboard: (payload) => send(payload),
    subscribeWhiteboard: (listener) => {
      wbListenersRef.current.add(listener);
      return () => wbListenersRef.current.delete(listener);
    },
    uploadChatFile: async (file, text, onProgress) => {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("peer_id", selfIdRef.current || "");
      if (text) form.append("text", text);
      const message = await uploadWithProgress(`/meetings/${code}/messages/upload/`, form, onProgress);
      mergeMessages([message]); // the WebSocket also delivers it; duplicates are ignored
      return message;
    },
    sendReaction: (emoji) => send({ type: "reaction", emoji }),
    admit: (peerId) => send({ type: "admit", peer_id: peerId }),
    deny: (peerId) => send({ type: "deny", peer_id: peerId }),
    muteParticipant: (peerId) => send({ type: "host-mute", peer_id: peerId }),
    removeParticipant: (peerId) => send({ type: "host-remove", peer_id: peerId }),
    endForAll: () => send({ type: "end-meeting" }),
  };
}
