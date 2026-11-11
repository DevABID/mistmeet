# MIST Meet

Developed by [Abidur Rahman](https://www.linkedin.com/in/abidurrahmanabid/).

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
- In-call chat, saved with the meeting, with clickable links
- **File sharing in chat** for everyone in the call: attach files (📎), paste images or screenshots (Ctrl/⌘+V),
  or drag and drop onto the chat. Images show as previews; other files as download cards. Upload progress, retry on failure,
  up to 10 files at once. Program files (.exe, .bat, .js, …) are blocked
- **Shared whiteboard**: pen, highlighter, line, arrow, rectangle, ellipse, text, LaTeX equations, eraser,
  6 colours, 3 sizes, grid paper, undo/redo, multiple pages, live drawing for everyone, works with mouse, touch and stylus.
  Download a page as PNG or all pages as PDF. Host can open it for everyone, lock it so only they can draw, and clear pages.
  The board is saved with the meeting, so late joiners and reloads see everything
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

## Chat file sharing

Files are stored in the database (table `meetings_chatfile`), because Render's disk is wiped on every deploy and whenever a
free service sleeps. Each file gets an unguessable signed link, so images display inline and downloads work in any browser
or download manager. Only PNG, JPEG, GIF and WebP open in the browser; every other type is always downloaded, so a shared
file can never run scripts on your site.

The free Render database holds 1 GB, so keep `CHAT_FILE_MAX_MB` modest. For heavy use, move file storage to S3 or
Cloudflare R2 with `django-storages`.

## Whiteboard

Open it with the whiteboard button in the call's control bar. The board uses a fixed 16:9 space (1600 × 900), so it looks
the same on phones, laptops and in exports.

- **Equations**: choose the Σ tool, click where it should go, type LaTeX (or tap a shortcut like fraction, integral or
  matrix), check the preview, then Insert. Rendering uses MathJax, loaded on demand from the jsDelivr CDN.
- **Undo/redo** (Ctrl/⌘+Z, Ctrl/⌘+Shift+Z) apply to your own changes.
- **Host menu (⋯)**: Open for everyone, Only I can draw / Let everyone draw, Clear this page.
- **Pages** are shared: moving to another page moves everyone, like a teacher turning the page.
- **Export**: PNG of the current page, or a PDF of every page (jsPDF, loaded on demand from jsDelivr).

Limits: 60 pages per board and 4,000 items per page. The board is stored in the `meetings_whiteboard` table.

## Attendance reports

Hosts can open a report from:
- **Home → Past meetings → Attendance**
- **In the call → Meeting details (ⓘ) → Open attendance report**, or the **Attendance** link in the People panel (opens a new tab so the host stays in the call)

The page is at `/report/<code>`. **Download PDF** produces an A4 landscape report in the host's local time zone.

API (host only, token auth):

| Endpoint | Returns |
|---|---|
| `GET /api/meetings/<code>/attendance/` | JSON report |
| `GET /api/meetings/<code>/attendance/pdf-link/?tz=Asia/Dhaka` | `{ "url": ... }` a signed download link, valid 2 minutes |
| `GET <that url>` | PDF file (plain browser download, works with or without download managers) |
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
| `DATABASE_URL` | PostgreSQL connection string | local SQLite |
| `CHAT_FILE_MAX_MB` | Largest file allowed in chat | `10` |

## Deploy: GitHub + Render

### 1. Push to GitHub

Create an empty repository on GitHub (for example `mist-meet`), then from the `mist-meet` folder:

```bash
git init
git add .
git commit -m "MIST Meet"
git branch -M main
git remote add origin https://github.com/<your-username>/mist-meet.git
git push -u origin main
```

`.gitignore` already keeps out `node_modules`, `venv`, `db.sqlite3` and `.env` files.

### 2. Create everything on Render with the Blueprint

1. In Render, click **New → Blueprint** and choose your GitHub repo. Render reads `render.yaml` and creates:
   - `mist-meet-db` (PostgreSQL)
   - `mist-meet-api` (Django + WebSockets, served by Daphne)
   - `mist-meet` (the React site)
2. Render asks for the values marked `sync: false`. Use the service names to fill them in:
   - `CORS_ALLOWED_ORIGINS` = `https://mist-meet.onrender.com`
   - `VITE_API_ORIGIN` = `https://mist-meet-api.onrender.com`
   - TURN fields: leave empty for now.
3. Click **Apply** and wait for all three to deploy.
4. Open each service in the dashboard and check its real URL. If Render added a suffix (e.g. `mist-meet-api-x1y2.onrender.com`),
   update the two variables to the real URLs, then **Manual Deploy** the frontend (it reads `VITE_API_ORIGIN` at build time)
   and the API.
5. Optional: create an admin user from the API service's **Shell** tab: `python manage.py createsuperuser`.

Every `git push` to `main` redeploys automatically.

### Render free plan: what to expect

- The free API **sleeps after 15 minutes without traffic** and takes about a minute to wake up. The first visit after a quiet
  period is slow; after that it's normal. Active calls keep it awake. A paid instance removes the sleep.
- **Free PostgreSQL databases expire 30 days after creation.** For a permanent free database, create one on Neon or Supabase and
  set `DATABASE_URL` on the API service to its connection string instead.
- Don't use SQLite on Render: the disk is wiped on every deploy and restart.

## Troubleshooting

| What you see | Cause and fix |
|---|---|
| Sign-in page says the server "didn't respond" or "is starting" | The frontend isn't reaching the API. On Render, open the **mist-meet** static site → Environment and check `VITE_API_ORIGIN` is the API's real URL (e.g. `https://mist-meet-api.onrender.com`, no trailing slash), then **Manual Deploy → Clear build cache & deploy**. If it's right, the free API is waking up; wait a minute. |
| "Can't reach the MIST Meet server" | Usually CORS: on the **mist-meet-api** service, set `CORS_ALLOWED_ORIGINS` to the frontend's exact URL, e.g. `https://mist-meet.onrender.com`. |
| "The server had a problem (500)" | Open **mist-meet-api → Logs**; the full error is printed there. |
| Test it directly | Open `https://<your-api>.onrender.com/api/health/` in the browser. You should see `{"status": "ok"}`. |

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
