import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, CODE_RE } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useMeeting } from "../hooks/useMeeting.js";
import Lobby from "../components/Lobby.jsx";
import MeetingRoom from "../components/MeetingRoom.jsx";
import StatusScreen from "../components/StatusScreen.jsx";

export default function MeetingPage() {
  const { code } = useParams();
  const valid = CODE_RE.test(code || "");
  if (!valid) {
    return <StatusScreen title="Check your meeting code" body="Meeting codes look like abc-defg-hij. Make sure you entered the full code." />;
  }
  return <Meeting code={code} />;
}

function Meeting({ code }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const meeting = useMeeting(code);
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(null);

  useEffect(() => {
    api(`/meetings/${code}/`).then(setInfo).catch((e) => setInfoError(e.status === 404 ? "not-found" : "network"));
  }, [code, meeting.status]);

  const home = () => navigate("/");

  if (infoError === "not-found" || meeting.errorReason === "not-found") {
    return <StatusScreen title="Check your meeting code" body="There's no meeting with this code. Ask the organizer to send the link again." onHome={home} />;
  }
  if (infoError === "network") {
    return <StatusScreen title="Can't reach MIST Meet" body="Check your internet connection, then reload the page." onHome={home} />;
  }
  if (!info) return <div className="screen-center"><div className="spinner" /></div>;

  if ((info.is_active === false && meeting.status === "lobby") || meeting.errorReason === "ended") {
    return <StatusScreen title="This meeting has ended" body="The host ended this call for everyone. Ask them for a new link if you still need to meet." onHome={home} />;
  }

  switch (meeting.status) {
    case "lobby":
    case "connecting":
    case "waiting":
      return <Lobby meeting={meeting} info={info} defaultName={user.display_name} />;
    case "joined":
      return <MeetingRoom meeting={meeting} info={info} />;
    case "left":
      return <StatusScreen title="You left the meeting" onRejoin={meeting.backToLobby} onHome={home} />;
    case "denied":
      return <StatusScreen title="You can't join this call" body="Someone in the call declined your request." onRejoin={meeting.backToLobby} rejoinLabel="Ask again" onHome={home} />;
    case "removed":
      return <StatusScreen title="You've been removed from the meeting" body="The host removed you from this call." onHome={home} />;
    case "ended":
      return <StatusScreen title="The meeting has ended" body="The host ended this call for everyone." onHome={home} />;
    case "disconnected":
      return <StatusScreen title="You lost your connection" body="Check your network, then rejoin." onRejoin={meeting.backToLobby} onHome={home} />;
    default:
      return <StatusScreen title="Something went wrong" body="Reload the page to try again." onRejoin={meeting.backToLobby} onHome={home} />;
  }
}
