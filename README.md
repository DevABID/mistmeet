# MIST Meet

A browser-based video meeting app built with **React** (Vite) and **Django** (Django REST Framework + Channels).
Audio and video travel peer-to-peer over **WebRTC**; Django handles accounts, meetings, chat history and real-time signaling.

## Features

- Accounts: register and sign in (username or email)
- New meeting menu: start instantly, create a link for later, or schedule with a title and time
- Join by code (`abc-defg-hij`) or by pasting the full link
- Pre-join screen: camera/mic preview, device pickers, editable display name, live "people in this call" count
- Waiting room: guests "Ask to join"; the host admits or denies (one at a time or "Admit all"). Anyone admitted once rejoins without asking again
- Multi-person video calls (grid layout, pin any tile, automatic spotlight for presentations)
- Mic and camera toggles (camera light turns off for real), keyboard shortcuts **Ctrl/⌘+D** and **Ctrl/⌘+E**
- Screen sharing ("Present now")
- Active-speaker highlight
- Raise hand, emoji reactions
- In-call chat, saved with the meeting
- People panel with host controls: mute a participant, remove a participant
- Host can "End call for everyone"
- **Attendance reports (host only)**: every participant's name, email, first join, last leave, total time in the meeting,
  number of sessions (rejoins), attendance %, and chat message count, plus "most at one time", average time and declined
  requests. Updates live during the call, sortable and searchable, and downloadable as a PDF
- Meeting details panel with copyable joining info
- Toasts for joins, leaves, raised hands
- Responsive down to mobile

## Project layout

```
mist-meet/
├── backend/                Django project
│   ├── mistmeet/           settings, urls, ASGI (HTTP + WebSocket)
│   ├── accounts/           register / login / me / logout (token auth)
│   └── meetings/           models, REST API, WebSocket consumer (signaling)
└── frontend/               React + Vite
    └── src/
        ├── hooks/useMeeting.js   WebRTC + signaling engine
        ├── pages/                Home, Auth, MeetingPage
        └── components/           Lobby, MeetingRoom, SidePanel, VideoTile…
```

## Run it locally

Requirements: Python 3.10+, Node 18+.

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
python manage.py makemigrations meetings
python manage.py migrate
python manage.py createsuperuser  # optional, for /admin
python manage.py runserver        # Daphne serves HTTP + WebSockets on :8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                       # http://localhost:5173
```

The Vite dev server proxies `/api` and `/ws` to Django, so no CORS setup is needed in development.

### 3. Try a call

Open http://localhost:5173, create two accounts (use a second browser or a private window for the second one),
start a meeting with the first and paste the link into the second.

> Browsers only allow camera/microphone on `https://` or `localhost`. To test from a phone or another computer
> on your network, serve over HTTPS (for example with `ngrok http 5173`, or a self-signed certificate) and add the host to `DJANGO_ALLOWED_HOSTS`.

## Attendance reports

Hosts can open a report from:
- **Home → Past meetings → Attendance**
- **In the call → Meeting details (ⓘ) → Open attendance report**, or the **Attendance** link in the People panel (opens a new tab so the host stays in the call)

The page is at `/report/<code>`. **Download PDF** produces an A4 landscape report in the host's local time zone.

API (host only, token auth):

| Endpoint | Returns |
|---|---|
| `GET /api/meetings/<code>/attendance/` | JSON report |
| `GET /api/meetings/<code>/attendance/pdf/?tz=Asia/Dhaka` | PDF file |
| `GET /api/meetings/?scope=past` | Your meetings that people attended |

How time is counted: from when a person is admitted (not while waiting in the lobby) until they leave or the host ends the
call. Rejoins and multiple devices are merged so overlapping time is counted once.

> Upgrading from the first version? This adds an `admitted_at` field, so run
> `pip install -r requirements.txt`, then `python manage.py makemigrations meetings && python manage.py migrate`.
> The PDF uses ReportLab's built-in Helvetica font, which covers English names. To print Bangla names, register a Unicode
> font (for example Noto Sans Bengali) in `meetings/pdf.py`.

## Configuration (environment variables)

| Variable | Purpose | Default |
|---|---|---|
| `DJANGO_SECRET_KEY` | Secret key | dev key (change it!) |
| `DJANGO_DEBUG` | `1` or `0` | `1` |
| `DJANGO_ALLOWED_HOSTS` | Comma-separated hosts | `localhost,127.0.0.1` |
| `CORS_ALLOWED_ORIGINS` | Frontend origins when served from another host | Vite dev URLs |
| `REDIS_URL` | Use Redis for Channels (required with more than one worker) | in-memory |
| `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL` | TURN server for strict networks | none (STUN only) |
| `VITE_API_ORIGIN` (frontend) | API host if different from the frontend host | same origin |

## Production notes

- **TURN server**: Peer-to-peer connections fail behind many campus, office and mobile networks without one. Run [coturn](https://github.com/coturn/coturn) and set the `TURN_*` variables.
- **Redis**: Set `REDIS_URL` and run Daphne/Uvicorn with multiple workers behind Nginx; proxy `/ws/` with `Upgrade` headers.
- **Client-side routes**: serve the built frontend with a fallback to `index.html` so links like `/report/<code>` and `/<code>` work on reload.
- **Database**: Switch SQLite to PostgreSQL for real usage.
- **HTTPS** is mandatory for camera/mic access.
- **Scaling**: The app uses a full mesh (every participant connects to every other). That's fine for small meetings (about 6–8 people with video).
  For bigger calls, replace the peer connections in `useMeeting.js` with an SFU such as LiveKit, mediasoup or Janus; the signaling, UI and REST API can stay as they are.

## Ideas for next steps

Recording (MediaRecorder or server-side via the SFU), live captions (Web Speech API), breakout rooms, polls,
background blur (MediaPipe selfie segmentation), calendar invites (.ics), and co-hosts.
