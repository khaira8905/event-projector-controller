# EventControl — Mission Control for Presentations

[![Live demo](https://img.shields.io/badge/live%20demo-eventcontrol.onrender.com%2Fdemo-2563eb)](https://eventcontrol.onrender.com/demo)
[![CI](https://github.com/khaira8905/event-projector-controller/actions/workflows/ci.yml/badge.svg)](https://github.com/khaira8905/event-projector-controller/actions/workflows/ci.yml)

A presentation control console for events, seminars, conferences and classrooms. One operator dashboard controls everything the projector shows: slides from **several independent PowerPoint/PDF files**, special screens (Please Wait, Technical Difficulty, Break, Thank You, custom announcements), logos, countdowns, images and videos. You don't need to open PowerPoint, Alt-Tab between windows or hunt for files.

```
UPLOAD → ORGANIZE → PREVIEW → QUEUE (Show Flow) → CONTROL → DISPLAY
```

**▶ Live demo: https://eventcontrol.onrender.com/demo**. No sign-up needed. You get your own private copy of a sample event to try everything, including the projector window (*Open display*). It lasts 10 minutes; if you like it, **Request access** on the sign-in page. The free server sleeps when unused, so the first visit may take ~30–60 s to wake.

**Tech stack:** React · TypeScript · Vite · Tailwind CSS · Node.js · Express · Socket.IO (real-time) · Prisma · PostgreSQL · Supabase (Auth, Storage) · Google Drive API (Picker) · Brevo · Docker · Render · GitHub Actions · Vitest · Playwright

![Operator console, White theme](docs/screenshots/console.png)

<details><summary>Blue theme</summary>

![Operator console, Blue theme](docs/screenshots/console-blue.png)

![Settings → Display: logo and Black Screen with a live preview](docs/screenshots/settings.png)

![Sign-in on the hosted version: accounts, Request access, Forgot password and the public demo](docs/screenshots/sign-in.png)

</details>

---

## ⚡ Quick start (no commands needed)

1. Install **Node.js LTS** from https://nodejs.org (one time), then restart your computer.
2. *Recommended:* install **LibreOffice** from https://www.libreoffice.org (free). It turns PowerPoint files into slides EventControl can control one by one. PDFs, images and videos work without it.
3. On GitHub click the green **`<> Code`** button → **Download ZIP**, then right-click the ZIP → **Extract All…**
4. Open the extracted folder and double-click:
   - **Windows:** `START-EventControl.bat`. If Windows shows "Windows protected your PC", click **More info → Run anyway**. If nothing happens, open the folder, type `cmd` in the address bar, and run `npm install` then `npm run dev`.
   - **macOS:** `START-EventControl-mac.command`. The first time, right-click it → **Open** → **Open**.
5. The first run installs packages (1–3 minutes). Then your browser opens **http://localhost:5173**.
6. **Create the operator password** when asked. This stops other people on the same Wi-Fi from controlling your projector.

Keep the black window open while you use EventControl, and close it to stop the app. Forgot the password? Stop the app and run `npm run reset-password`.

---

## What the operator can do

| Area | Features |
| --- | --- |
| **Files** | Upload PPT, PPTX, PDF, images (PNG/JPG/WEBP) and videos (MP4/WEBM/MOV) by drag-and-drop, from this computer, or **import from Google Drive** (PowerPoint, Google Slides and PDF). Each file shows a thumbnail, slide/page count and status. Organise files in **folders**, **preview** privately, **show** a file now, add it to the Flow, rename, move, download or delete it. Duplicates are detected and skipped. |
| **PowerPoint handling** | PPT/PPTX files are converted to PDF in the background with LibreOffice. The **original file is kept** and the converted version is what the display renders, which gives real slide-by-slide control. "Open in PowerPoint" launches the original if you need animations or embedded media. |
| **Flow (the main workspace)** | The running order of the event, taking most of the Control screen: `01 Starting Soon → 02 Opening (slides 1–8) → 03 Please Wait → 04 Speaker 1 → …`. **Click an item to put it on the projector.** The item on screen opens up to show its slides; click a slide to jump to it. **Add** presentations (several at once, straight from upload or Drive) and screens; **Edit** to change slide ranges, durations, speaker notes or remove items; drag the handle to reorder. It scrolls smoothly however many items there are. **Next** walks through the slides of the current item, then on to the next item. |
| **Control screen** | Two balanced halves. **Left, the work:** what's on (a coloured tally, the presentation name, speaker notes), the transport toolbar `‹ Previous │ Slide 2 / 36 │ Next ›` (click the number to jump; *Next* says what it will do), the **Flow** with large, readable rows — the item on screen, *Next*, what's upcoming, and finished items stepping back — and the **Timer** docked under it. **Right, the display:** projector status, a large picture of what the audience sees (it grows into the free height), the **display bar** attached to it — **Black screen** (reads *ON* while black), **Logo**, **Overlay**, PowerPoint and **Fullscreen** — then **Up next** and the **Quick Selection** keypad. Short screens compress previews first; narrow ones turn secondary labels into icons. **Presenter mode** hides everything else. |
| **Special screens** | Built-in **Please Wait, Technical Difficulty, We'll Be Back Shortly, Session Starting Soon, Coming Up Next** (announces the next item automatically) and **Thank You**. Each has its own hand-built animation: slow ripples, TV colour bars with a signal glitch, a steaming coffee cup, a sweeping clock ring, chevrons pulling toward what's next, and falling paper confetti. You can edit their text and create **custom screens** (title, subtitle, colour, image/video background). Any screen can be shown **with a countdown** ("Please Wait — 05:00") whose digits roll as they change. |
| **Quick Selection** | Your own shortcut buttons (default: Please Wait, Technical Difficulty, We'll Be Back Shortly, Show Logo), pressed with keys `1`–`8`. **Customize** to add screens, files or actions, remove them, reorder them, rename them and pick a colour. Saved with the event, so every console sees the same set. |
| **Black Screen** | One toggle under Previous/Next with an unmistakable state (outlined → solid *Black is on*), or `B`; press again to bring the picture back. Set up once in **Settings → Display**: pure black or a branded card (your logo at its own proportions — never stretched — small, medium or large, centred, lower third or corner, a gentle one-time entrance, optional status text such as *We'll be right back*), fade or instant cut, two-click protection, and whether Next while black brings back the same slide or moves on. |
| **Branding** | A logo overlay (university, event or sponsor logo) drawn over slides and screens. Choose the position (4 corners or centre), size, opacity and show/hide. There's also a separate full-screen logo mode. |
| **Timer** | A server-authoritative countdown (start/pause/reset, ±1 min, warning threshold, show/hide on display), shown large on special screens and as a corner badge over slides. When time runs out, the console keeps counting the **overtime in red** (+01:25) while the audience still sees 00:00. A **Clock** tab shows the current time. |
| **Top bar & rail** | Projector connected / offline (click to open the display window), storage status and upload progress, presenter mode, theme and **Open display**. The narrow rail on the left has labelled sections: Control, Files, Screens, Branding, Timers and Settings, plus free disk space and the operator. |
| **Schedule** | A time-based run sheet (NOW / NEXT) as an operator reference. |
| **Accounts** | Sign in with an account created by the administrator in Supabase Auth. Events, files, Flow and Google Drive connections are private to each account, so several people can run shows on one server at the same time; theme, shortcuts, layout and other console settings are saved to the account and follow the person to any computer. |
| **Script layout** | One click in the top bar (or Settings → Presentation) swaps the Flow and Quick Selection: the left side shows a large, adjustable script for the item on screen (with the next item's opening line), Quick Selection under it; the Flow moves to the right under the picture. Each Flow item has its own script (Edit → Script), never shown to the audience. |
| **Settings** | A control centre in six groups, each saving as you change it and saying where it's saved (with the event, or on this computer): **Presentation** (what Start shows, reopen decks at the first slide or where you left them, show on click or on double-click, ask before switching decks mid-way, Flow layout detailed/compact, follow the item on screen, slide thumbnails and their size, Quick Selection), **Display** (upload/replace/remove the logo, Black Screen look and behaviour with a live preview, projector picture, display link), **Controls** (keyboard shortcuts on/off and fully editable, mouse on the picture, key hints, compact controls), **Files & integrations** (upload, Google Drive, connected accounts), **Appearance** (White/Blue theme, animations, presenter mode) and **Event & sharing** (details, console and projector links). |
| **Motion & feel** | IBM Plex type (bundled, works offline) with one type scale, a 4px spacing grid, crisp 4px control corners and three motion speeds. Buttons lift a pixel on hover and sink when pressed; arrows nudge the way they point, play/pause swap, reset spins back once. Flow rows glide when reordered (also by another console), new items arrive with a brief highlight, removed ones fold away, and the current row's bar settles in. Loading says what it's doing (*Opening event…*, *Making slides…*). Nothing moves unless something changed; with *reduce motion* the console is completely still. On the projector, everything cross-fades with no flash of black. |
| **Reliability** | The display keeps the last content if the network drops, reconnects on its own and restores the exact state (slide, screen, overlay, timer). The console survives long pauses too: after a reconnect, a server restart or a tab the browser put to sleep, it re-joins, reloads the Flow and files it may have missed, and reconnects immediately when you come back to the tab. The projector laptop is kept awake while the display is open. Files are always served from a local copy, so everything works offline. |

### Keyboard shortcuts

Defaults below. **Every key can be changed** in **Settings → Controls**: click a key and press the new one, `+` adds a second key, `×` removes one, and each action (or everything) can be reset. If a key is already used by another action, the editor asks before moving it — keys never silently overwrite each other. Press `?` in the console for the keys in effect.

| Key | Action |
| --- | --- |
| `→` / `Space` / `PgDn` | Next slide / next item |
| `←` / `PgUp` | Previous slide / item |
| `S` | Start the presentation |
| `Esc` | Back to the presentation (leave black, a quick screen or a library file) |
| `L` | Exit the presentation (logo screen) |
| `B` | Black screen on / off |
| `G` | Go to a slide number |
| `Shift` + `F` | Open the Flow (Control view) |
| `/` | Select a presentation: focus the Flow, `↑` `↓` to choose, `Enter` to show |
| `H` | Show / hide controls (presenter mode) |
| `1` – `8` | Quick Selection buttons |
| `F` | Fullscreen the display |
| `W` / `T` | Please Wait / Technical Difficulty screen |
| `O` | Show / hide logo overlay |
| `P` / `R` | Start-pause / reset the timer |
| `?` | Shortcut overview |

Shortcuts are ignored while typing, and holding a key never skips several slides. On the display window, a click or `F` toggles fullscreen.

---

## Architecture

EventControl runs two ways from the same code: **hosted** (the public site, below) and **local** (on a laptop at the venue, further down).

**Hosted (eventcontrol.onrender.com):**

```mermaid
flowchart LR
  subgraph Browser
    OP["Operator console<br/>React · /events/:id"]
    DP["Projector display<br/>React · /display/:id"]
    GP["Google file picker"]
  end
  subgraph Render["Render · Docker"]
    S["EventControl server<br/>Express · Socket.IO · Prisma"]
  end
  OP <-->|"REST + Socket.IO<br/>signed in, own events only"| S
  S -->|"Socket.IO, read-only"| DP
  GP -.->|"ids of picked files"| OP
  S --> PG[("Supabase Postgres<br/>events, accounts")]
  S --> ST[("Supabase Storage<br/>files")]
  S --> AU["Supabase Auth<br/>logins"]
  S --> BR["Brevo<br/>email codes"]
  S --> GD["Google Drive API<br/>picked files only"]
  UP["UptimeRobot · GitHub Actions"] -.->|"keep awake"| S
```

Every request runs as the signed-in account (AsyncLocalStorage) and every event query is limited to that account's events, so people sharing the server never see each other's work. The public demo gives each visitor a temporary guest account with a private copy of a sample (or the administrator's showcase) event.

**Local (a laptop at the venue):**

```
┌─────────────────────────┐   REST + Socket.IO    ┌────────────────────────────────────┐   HTTPS (optional)   ┌───────────────────┐
│ Operator dashboard      │ ◀──────────────────▶ │ EventControl server (this laptop)  │ ───────────────────▶ │ Supabase Storage  │
│ React · /events/:id     │   (signed-in)         │ Express · Socket.IO · SQLite       │   file copies        │ (cloud bucket)    │
└─────────────────────────┘                       │ • authoritative display & timer    │ ◀─────────────────── │                   │
┌─────────────────────────┐   Socket.IO (read)    │ • Show Flow navigation             │   restore if missing └───────────────────┘
│ Projector display       │ ◀──────────────────── │ • PPTX → PDF (LibreOffice)         │
│ React · /display/:id    │                       │ • local file copies (uploads/)     │
└─────────────────────────┘                       └────────────────────────────────────┘
```

```
event-control/
├── client/src/
│   ├── pages/           EventsPage, DashboardPage (operator console), DisplayPage (projector)
│   ├── components/
│   │   ├── dashboard/   FlowPane (the Flow), StagePane (picture + transport), QuickSelection (+ editor), TimerStrip,
│   │   │                FilePicker, DriveBrowser, SettingsView, PresentationLibrary, ScreensPanel, BrandingPanel…
│   │   ├── display/     DisplayStage (renders any state, used by display + live preview), PdfView,
│   │   │                ScreenScene (special screens + their motifs), motion (crossfades, rolling digits), Confetti
│   │   └── AuthGate     first-run password / sign-in
│   ├── styles/motion.css  every animation, eased by hand, with a reduced-motion fallback
│   ├── styles/themes.css  console colour themes (White, Blue); console.css: cards, sidebar, tables, on-air frame
│   ├── hooks/           useEventSocket (realtime state), useTimerRemaining, useKeyboardShortcuts, useSystemStatus
│   └── lib/             pdf.js loader & thumbnails, flow helpers, formatting
├── server/src/
│   ├── integrations/    google (OAuth, encrypted tokens, file picker session, Drive import)
│   ├── lib/             prisma, errors, logger, rateLimit (expiring per-visitor limits)
│   ├── controllers/     events, media, queue (Show Flow), screens, schedule, control, auth, status
│   ├── services/
│   │   ├── displayService    what is on screen + Next/Previous across slides & files
│   │   ├── timerService      authoritative countdown
│   │   ├── controlService    one typed command dispatcher (socket + REST)
│   │   ├── processingService PDF page counts, PPTX → PDF conversion queue
│   │   ├── storage/          CloudStorage interface + Supabase implementation
│   │   ├── cloudSync         background upload/retry, restore-from-cloud, delete
│   │   ├── authService       password hashing, signed sessions, Supabase Auth
│   │   ├── accounts          current user, per-account scoping, removed-account checks
│   │   ├── accessRequests    Request access, email codes, approvals, forgot password
│   │   ├── demoAccounts      public demo guests, limits, showcase, clean-up
│   │   ├── eventCopy         complete independent copy of an event (demo showcase)
│   │   ├── email · supabaseAdmin   Brevo emails · Supabase Auth admin API
│   │   └── screenService     built-in special screens
│   ├── socket/          rooms (operators / displays), join + control handlers
│   └── scripts/         reset-password
├── prisma/schema.prisma SQLite: Event, Media, QueueItem (Show Flow), Screen, ScheduleItem, TimerState, DisplayState, Setting
└── uploads/             local copies: <event>/{presentations,documents,images,videos}/
```

### Key architectural decisions

| Decision | Why |
| --- | --- |
| **Local-first server + cloud file storage** (not a cloud-only backend) | Venue Wi-Fi is unreliable, and a live show must never depend on it. The local server is the realtime hub between the dashboard and the display, and keeps a local copy of every file. The cloud holds durable copies of the uploads; if a local file is missing (cleaned disk, reinstall), it is restored from the cloud automatically. |
| **Supabase via its REST API, behind a `CloudStorage` interface** | No SDK lock-in. Swapping in S3, Firebase Storage or another provider means writing one small class (`server/src/services/storage/`). With no Supabase settings, the app runs fully locally. |
| **SQLite locally, Postgres when hosted** | On a laptop, events, flows, screens and state live in a SQLite file next to the server (zero setup, offline-safe). Set `DATABASE_URL` to a Postgres URL (e.g. Supabase) and the same schema runs on Postgres — that's how the free cloud deployment keeps its data. `scripts/prisma.mjs` switches the Prisma provider automatically; the test suite passes on both. |
| **PPTX → PDF with LibreOffice, keeping the original** | Browsers cannot render PowerPoint. LibreOffice's headless export preserves layout, fonts and images well and runs offline. Conversion happens in a one-at-a-time background queue with a private LibreOffice profile (so it doesn't clash with an open LibreOffice window) and a timeout. Animations/transitions and embedded video in decks are not reproduced; use "Open in PowerPoint" for those decks. |
| **pdf.js (legacy build) renders slides in the browser** | Pixel-accurate slides, instant page flips (documents are cached), thumbnails, and it works on older projector-laptop browsers. |
| **Server-authoritative state, full snapshots** | Every change broadcasts a complete, versioned display snapshot. A display that reconnects or refreshes asks once and is exactly in sync. Emergency modes (black/logo) and slide flips reuse the cached snapshot, so they're applied in milliseconds. |
| **One command dispatcher** | Socket.IO `control` events and `POST /api/events/:id/control` run the same typed commands, so a phone remote or Stream Deck can be added later without touching the core. |
| **Sessions in an HttpOnly cookie** | They work transparently for REST, uploads and the Socket.IO handshake. Displays don't need to sign in, so the projector machine needs no password; only operator control is protected. |
| **Motion in plain CSS, sized with container units** | The animations only change `transform` and `opacity`, so they stay smooth on a modest projector laptop, and they need no animation library. The operator's live preview is the same component as the projector, sized with container-query units, so it's an exact miniature, animations included. Fonts (Bricolage Grotesque, Instrument Serif, JetBrains Mono, Inter) are bundled, so screens look the same with no internet. |
| **Accounts scoped on the server, not the client** | Each request runs as its account (AsyncLocalStorage) and every query filters by owner; someone else's event answers "not found" (404, not 403) so it doesn't even reveal it exists. Tests try every route as another account. |
| **Public demo as throwaway guest accounts** | Visitors get a real, private copy instead of a shared playground nobody can trust: a stranger's upload can never appear for the next visitor. Small limits and automatic deletion keep it cheap on a free server. |
| **Google Drive through Google's own picker (`drive.file`)** | People choose files in Google's window, so EventControl only ever gets those files, never the whole Drive. It's a non-sensitive scope: no "unverified app" warning or user cap. The refresh token stays encrypted on the server; the browser only gets a short-lived token for the picker. |
| **Real visitor addresses behind proxies** | Render puts three proxies in front of the app; trusting exactly three (`TRUST_PROXY=3`) gives each visitor's own address for the rate limits, and a forged `X-Forwarded-For` is ignored. |
| **Schema changes are additive** | Existing installs upgrade in place with `prisma db push` (run automatically by `npm run dev`); nothing is lost. |

---

## Installation & running (developer view)

Requirements: **Node.js ≥ 20**, npm. Optional: **LibreOffice** (PowerPoint conversion).

```bash
npm install        # client + server (npm workspaces) and the Prisma client
npm run dev        # http://localhost:5173 (API + Socket.IO on :4000, proxied by Vite)
```

Production (single port, e.g. for a dedicated laptop):

```bash
npm run build
npm start          # everything on http://localhost:4000
```

| Command | Purpose |
| --- | --- |
| `npm test` | Server integration tests (SQLite; `TEST_DATABASE_URL=postgresql://…` runs them on an empty Postgres database): auth, Show Flow navigation across files and slide ranges, screens, overlay, real PPTX conversion (if LibreOffice is installed), cloud storage against a mock Supabase API, and more |
| `npm run e2e` | Browser end-to-end check against the running app (`E2E_PASSWORD=…` only in private mode; needs `npx playwright install chromium` once or `CHROME_PATH`) |
| `npm run typecheck` | TypeScript checks |
| `npm run reset-password` | Clear the operator password (the next visit asks for a new one) |
| `npm run db:reset` | Wipe the database (the demo event is re-created on the next start) |

### Configuration

Copy **`.env.example`** to **`.env`** in the project folder and fill in what you need. Everything is optional.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | SQLite `prisma/eventcontrol.db` | `file:/path/to.db` or a Postgres URL (`postgresql://…`, e.g. Supabase) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | empty | Enable cloud storage (see below) |
| `SUPABASE_BUCKET` | `eventcontrol` | Storage bucket name |
| `AUTH_PROVIDER` | `none` (open) | **`supabase` = accounts** (the hosted setup): people sign in with the email/password you create in Supabase Auth; each account sees only its own events, and its console settings follow it to any computer. Needs `SUPABASE_URL` + `SUPABASE_ANON_KEY`. `local` = one operator password. Empty/`none` = open to anyone with the link |
| `ADMIN_EMAIL` | first account | The account that takes over events created before accounts were turned on |
| `DEMO` | `on` with accounts | `off` removes "Try the demo" (temporary guest accounts with a copy of the sample event) |
| `DEMO_MINUTES` | `10` | How long a demo lasts before it and everything in it is deleted |
| `ACCESS_REQUESTS` | `on` with accounts | `off` removes "Request access" from the sign-in page |
| `ACCESS_REQUESTS_PER_HOUR` | `5` | Most new requests an hour, from everyone together |
| `BREVO_API_KEY` · `EMAIL_FROM` | — | Emails for Request access: code to confirm the address, notes to you and to them ([DEPLOY.md Part D](docs/DEPLOY.md)) |
| `DEMO_MAX_ACTIVE` | `40` | Most demos at the same time (protects the free server) |
| `PUBLIC_APP_URL`, `PUBLIC_API_URL` | empty | Only when the UI is hosted separately from the server (see *Sharing a public link*) |
| `CORS_ORIGINS` | empty | Extra sites allowed to call the API |
| `SESSION_HOURS` | `24` | Longest a sign-in lasts. Closing the console tab (or the browser) always ends it sooner. |
| `SOFFICE_PATH` | auto-detected | Path to LibreOffice's `soffice` if it's installed somewhere unusual |
| `CONVERSION_TIMEOUT_SECONDS` | `180` | Give up converting a deck after this long |
| `PORT` / `HOST` | `4000` / `0.0.0.0` | Server address (all interfaces, so a projector PC on the LAN can connect) |
| `MAX_UPLOAD_MB` | `1024` | Per-file upload limit |
| `ALLOW_EXTERNAL_OPEN` | `true` | Allow "Open in PowerPoint" — only ever for a browser on the server machine itself |
| `SEED_DEMO` | `true` | Create the demo event when the database is empty |

### Enabling cloud storage (Supabase)

1. Create a free project at https://supabase.com.
2. **Storage → New bucket** → name it `eventcontrol` and keep it **private**.
3. **Project Settings → API** → copy the **Project URL** and the **service_role** key into `.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
4. Restart EventControl. The status bar shows **CLOUD SYNCED** once uploads are copied, and each file card shows its cloud status. Existing files are uploaded automatically.

The service key stays on the server (it is never sent to the browser). Uploads are retried with backoff if the connection drops.

## Sharing a public link

EventControl is one web app: the same server hosts the page, the API and the live connection, and the browser always talks to **the address it was opened at**. There is no `localhost` anywhere in the app — `localhost` only appears because `npm run dev` runs it on your own computer, which other people can't reach. To give people a link, run it somewhere they *can* reach:

```
 Anyone's browser ──https──▶  EventControl (public address)  ◀──https──  Projector computer
   (console link)              UI + API + live updates                 (display link, a browser)
```

The projector needs no special software: it is just a browser showing the display link, connected **outwards** to the same address, so nothing on the venue computer is exposed to the internet.

| Option | Link | Good for |
| --- | --- | --- |
| **Hosted** (Render, below — free) | permanent `https://…onrender.com` | the normal way; works when your laptop is off |
| **`npm run share`** on your laptop | temporary `https://….trycloudflare.com` | a quick link without an account; works while the window is open |
| Same Wi-Fi only | `http://<laptop-ip>:4000` (printed at start) | a projector PC in the same room |

`npm run share` builds the app, starts it on one port and opens a free Cloudflare quick tunnel (install `cloudflared` once: `winget install --id Cloudflare.cloudflared` on Windows, `brew install cloudflared` on a Mac). It prints the public link.

**Accounts (hosted default).** With `AUTH_PROVIDER=supabase` everyone signs in with an account you create in Supabase (no sign-up page, no captcha); each person has private events, files and settings, and several people can run shows on the same server at once. See [docs/DEPLOY.md → Part C](docs/DEPLOY.md). **Open mode** (`AUTH_PROVIDER=none`, the local default): opening the link is enough; there are no accounts or sign-in screens. Share the console link only with your crew — whoever has it can run the show. The projector link only shows the audience picture. Connecting Google Drive is optional and personal: each browser connects its own account and nobody else sees it. "Open in PowerPoint" is only offered on the computer that runs EventControl and never to visitors. For a private set-up set `AUTH_PROVIDER=local`.

Deep links (`/events/…`, `/display/…`) work after a refresh: the server returns the app for any page address, and built assets are cached safely (hashed names; the page itself is always revalidated, so a new deploy reaches everyone).

**UI on a separate host** (optional, e.g. a static host in front of an API server): build the client with `VITE_API_URL=https://api.example.com npm run build -w client`, and set `PUBLIC_APP_URL=https://show.example.com` and `PUBLIC_API_URL=https://api.example.com` on the server. Only that UI address is allowed to call the API with cookies (both must be HTTPS).

## Free cloud hosting (Render + Supabase)

**Step-by-step guide with troubleshooting: [docs/DEPLOY.md](docs/DEPLOY.md).**

Run EventControl on the internet at no cost: **Render** (free web service) runs the server, and **Supabase** (free plan) stores the database and the uploaded files. Neither needs a credit card.

> **Honest trade-offs of free hosting**
> - Render's free instance **sleeps after ~15 minutes without visitors**; the first visit after that takes about a minute to wake it. **Open the dashboard 5 minutes before your event starts.**
> - Every slide change travels over the venue's internet. For events with unreliable Wi-Fi, running on your laptop (Quick start) is still the most reliable option.
> - The free Supabase project pauses after a week without use. Restore it from the Supabase dashboard (your data is kept).
> - Free limits: 512 MB memory on Render (plenty for EventControl), 1 GB of file storage and 500 MB of database on Supabase.
> - "Open in PowerPoint" is disabled on a hosted server. Everything else works, including PowerPoint → slides conversion (LibreOffice is inside the container).

### 1. Supabase (database + file storage)

1. Sign up at https://supabase.com → **New project**. Choose a name, a **database password** (write it down) and a region near your venue.
2. **Storage → New bucket** → name `eventcontrol` → keep **Public** switched **off** → Create.
3. Click **Connect** (top of the project page) → **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with your database password (if it contains symbols like `@`, `#` or `/`, pick a password with only letters and numbers instead). Use the **Session pooler** one: Render can't reach the "Direct connection" address.
4. **Project Settings → API** → copy the **Project URL** and the **service_role** key (click "Reveal"). Keep the service_role key secret.

### 2. Render (the server)

1. Sign up at https://render.com with your GitHub account.
2. **New → Blueprint** → select your `event-projector-controller` repository → Render reads `render.yaml` and proposes a free web service called **eventcontrol**.
3. Fill in the three values it asks for:
   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the Session pooler URI from step 1.3 |
   | `SUPABASE_URL` | the Project URL from step 1.4 |
   | `SUPABASE_SERVICE_ROLE_KEY` | the service_role key from step 1.4 |
4. Click **Apply**. The first build takes ~10 minutes (it installs LibreOffice). When the log shows `EventControl server listening`, open the `https://eventcontrol-….onrender.com` address Render shows.
5. Set up accounts ([docs/DEPLOY.md → Part C](docs/DEPLOY.md)): turn off sign-ups in Supabase, create users, and add `SUPABASE_ANON_KEY` in Render. Everyone then signs in and sees only their own events.

Every push to `main` redeploys automatically. Events and files survive restarts and redeploys (they live in Supabase; files are cached on the server and re-downloaded when needed).

**Projector:** open `https://<your-app>.onrender.com/display/<eventId>` on the projector computer (the dashboard's **Open Display** button does this for you).

**Other Docker hosts:** the same `Dockerfile` runs anywhere (Railway, Fly.io, a VPS, a Raspberry Pi…). Set `DATABASE_URL` (Postgres, or `file:/data/eventcontrol.db` on a persistent volume), and optionally `SUPABASE_*` for file storage.

### Google Drive

Import presentations straight from Google Drive (Settings → File sources → Google Drive → **Connect**, or **Add → Presentations & files → Google Drive** in the Flow). It is optional and needs a free Google OAuth client, set up once:

1. Open [Google Cloud Console](https://console.cloud.google.com/) → create a project → **APIs & Services → Library** → enable **Google Drive API** and **Google Picker API**.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform): *External*, app name and your email. Under **Data access**, the only Drive scope is `…/auth/drive.file`. Then **Audience → Publish app**: `drive.file` is a non-sensitive scope, so anyone can connect, with no test-user list, no "unverified app" warning and no user limit.
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized redirect URIs* add every address the app is opened at + `/api/auth/google/callback`, e.g. `https://your-app.onrender.com/api/auth/google/callback` (and `http://localhost:5173/api/auth/google/callback` for development). A `trycloudflare.com` link changes every time, so for Drive use a hosted address.
4. **Credentials → Create credentials → API key** (for Google's file picker). *Edit API key*: **Application restrictions → Websites** → `https://your-app.onrender.com/*`; **API restrictions → Restrict key → Google Picker API**. This key is meant for browsers: with those restrictions it only works on your site, only for the picker.
5. Put the values in `.env` (or Render → Environment) and restart:
   ```
   GOOGLE_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=…
   GOOGLE_API_KEY=…
   ```
6. Private mode only (`AUTH_PROVIDER=local`): `GOOGLE_ALLOWED_EMAILS=you@college.edu,colleague@college.edu` adds **Continue with Google** to the sign-in page for those accounts.

How it works: people pick files in **Google's own file picker**, and EventControl gets access to **only those files** (`drive.file`), never the rest of their Drive. The server does the OAuth exchange: the client secret and the long-lived refresh token never reach the browser (stored encrypted); the picker gets a short-lived access token limited to `drive.file`. Imported files are copied onto the server (to turn PowerPoint into slides and keep the show running if the venue Wi-Fi drops); duplicates are recognised. Disconnecting revokes the access at Google. Connections made before this change (read access to the whole Drive) keep working.

### Installing LibreOffice (PowerPoint slides)

- **Windows / macOS:** install from https://www.libreoffice.org. EventControl finds it automatically.
- **Linux:** `sudo apt install libreoffice-impress` (or your distribution's equivalent).

Decks uploaded before LibreOffice was installed are converted automatically on the next start, or immediately via the card's **⋯ → Retry slide conversion**.

---

## Running an event

1. **Create / open the event** (← Events → **Create Event**).
2. **Upload** decks, PDFs, logos and videos into folders. PowerPoint files show *Converting slides…* for a few seconds, then *24 slides*.
3. **Preview** a file (👁) to check it privately. From the preview you can add a slide range (e.g. slides 1–8) to the flow or put a slide live.
4. **Build the Flow** on the Control screen: **Add → Presentations & files** (tick several, or upload/import them right there) and **Add → a screen** for Please Wait / Break / Thank You… Drag the handles to reorder; **Edit** to set slide ranges, durations and speaker notes.
5. **Connect the projector:** set the display to *Extend*, click **Open Display**, drag the window to the projector and click it once (fullscreen, and it allows video sound). The top bar shows **Projector connected**. From another computer, open `http://<laptop-ip>:5173/display/<eventId>` (or `:4000` in production); the IP is printed when the server starts.
6. **Run the show**: press **Start**, then `→`/`Space` or **Next**, or click any Flow item or slide. Use Quick Selection (or `W` / `T` / `B`) for interruptions and **Back to …** / `Esc` to return to the exact slide. Use `O` for the logo overlay and Screens for "Please Wait — 05:00" countdowns. Turn on **presenter mode** to hide everything else.

![Show flow and live control](docs/screenshots/show-flow.png)

---

## Realtime protocol (Socket.IO)

```ts
socket.emit('event:join', { eventId, role: 'operator' | 'display' }, ack)
// ack → { ok, data: { display: DisplaySnapshot, timer: TimerSnapshot, presence } }
// Operators must be signed in (session cookie); displays can always join (read-only).
```

| Room | Members | Receives |
| --- | --- | --- |
| `event:<id>` | everyone | `display:update` (full versioned snapshot), `timer:update`, `event:changed`, `event:deleted` |
| `event:<id>:operators` | dashboards | `queue:changed`, `media:changed`, `screens:changed`, `schedule:changed`, `presence:update`, `display:fullscreen-result` |
| `event:<id>:displays` | projector windows | `display:video`, `display:fullscreen` |

Operator commands (`socket.emit('control', command, ack)` or `POST /api/events/:id/control`):

```ts
{ type: 'next' } | { type: 'previous' }                         // slides, then the next/previous Show Flow item
{ type: 'show-item', queueItemId, page? }                      // put a flow item on air (optionally a slide)
{ type: 'show-media', mediaId, page? }                         // show a library file directly
{ type: 'page', page } | { type: 'page', delta }               // jump to a slide
{ type: 'show-screen', key: 'please-wait', timerMs?: 300000 }  // or screenId; optional countdown
{ type: 'show-current' }                                       // resume (Esc)
{ type: 'black' } | { type: 'logo' }
{ type: 'overlay', visible?, mediaId?, position?, size?, opacity? }
{ type: 'video', action: 'play' | 'pause' | 'restart' } | { type: 'fullscreen' }
{ type: 'timer-start' | 'timer-pause' | 'timer-toggle' | 'timer-reset' }
{ type: 'timer-adjust', deltaMs } | { type: 'timer-configure', durationMs?, warningMs?, showOnDisplay? }
```

The display state the server keeps (and every display renders):

```text
mode (media | screen | black | logo) · current Show Flow item · current page/slide · slide range
current screen · logo overlay (media, position, size, opacity, visible) · timer state · version
```

### REST API

All routes except sign-in, health and media file downloads require the operator session.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/auth/status` | `{ provider, configured, authenticated }` |
| POST | `/api/auth/setup` · `/login` · `/logout` · `/change-password` | Sign-in management |
| GET | `/api/status` | Cloud storage, conversion and server health |
| GET/POST | `/api/events` | List / create events |
| GET/PUT/DELETE | `/api/events/:id` | Event (incl. overlay settings, full-screen logo) |
| GET/POST | `/api/events/:id/media` | List / upload (`multipart`, field `files`, `?folder=Sponsors`) |
| PATCH/DELETE | `/api/media/:id` | Rename / move folder (`{ name?, folder? }`) / delete (local + cloud) |
| GET | `/api/media/:id/file` · `/render` | Original file · converted slides PDF (HTTP range support) |
| POST | `/api/media/:id/convert` · `/open` | Retry PPTX conversion · open in the native app on the server machine |
| GET/POST/PUT | `/api/events/:id/queue` | Show Flow: list / add (`{ mediaId, startPage?, endPage? }` or `{ kind: 'screen', screenId }`) / reorder |
| PATCH/DELETE | `/api/queue/:id` | Edit title, slide range, duration, notes / remove |
| GET/POST | `/api/events/:id/screens` | Special screens (built-ins are created automatically) |
| PATCH/DELETE | `/api/screens/:id` | Edit / delete (custom screens only) |
| GET/POST, PATCH/DELETE | `/api/events/:id/schedule`, `/api/schedule/:id` | Run sheet |
| GET | `/api/events/:id/state` | Current display + timer + presence |
| POST | `/api/events/:id/control` | Any control command |
| PUT | `/api/events/:id` with `{ preferences }` | Quick Selection, default presentation/slide, Black confirmation (merged) |
| GET | `/api/integrations` | Connected services for this browser (Google today; a registry built for more), with status and what each unlocks |
| GET · POST | `/api/integrations/google` · `/disconnect` | Google connection status · disconnect and revoke |
| GET | `/api/integrations/google/connect?returnTo=` | Start connecting Google Drive (redirects to Google) |
| GET | `/api/integrations/google/picker` | Short-lived `drive.file` token, project number and browser key for Google's file picker |
| POST | `/api/events/:id/media/drive` | Import Drive files (`{ fileIds: [...] }`) |
| GET | `/api/auth/google/start` · `/callback` | Sign in with Google (allow-listed accounts) · OAuth callback |

---

## Security & reliability

- **Public hosted version (eventcontrol.onrender.com): locked down.** Everyone signs in; accounts exist only after the administrator approves a request (email verified with a code), and each account sees only its own events, files and projector. The public demo gives every visitor a **private, throwaway copy** of a sample event: nobody else can see or change it, it's capped (25 MB per upload, 25 files, 5 events, 5 demos per visitor an hour, no Google Drive) and deleted after 10 minutes, so a visitor always starts from a clean sample. Uploads for accounts are capped at 200 MB; code emails at 5 an hour per address; "Open in PowerPoint" is off. Removed accounts are signed out within about 2 minutes.
- **Local install (default on your own computer):** open, for a crew on a trusted network — anyone with the link uses the console, without accounts (by request). Per-browser data (a connected Google account) is tied to a random HttpOnly browser cookie, so visitors never see each other's Drive. Actions on the server machine's desktop ("Open in PowerPoint") are refused for any request that didn't come from that machine, including through a tunnel or proxy. Security headers, CORS only for a configured UI origin, and a production log of failed and slow requests.
- **Private mode (optional):** scrypt-hashed operator password (or Supabase Auth, or Google for allow-listed accounts), HMAC-signed HttpOnly `SameSite=Strict` session cookie, rate-limited sign-in, and a password change signs out other sessions. Operator REST routes and socket control require a session; displays are read-only.
- **Uploads:** extension allowlist and **magic-byte check** (a renamed `.exe` is rejected), sanitized filenames, random temp names, size limits and SHA-256 duplicate detection.
- **Google:** server-side authorization-code flow with a signed `state` bound to a short-lived nonce cookie (CSRF-safe), same-origin return paths only, `drive.file` scope (only files picked in Google's picker), AES-256-GCM encrypted tokens, revoke on disconnect.
- **Paths:** every stored path is resolved and confined to `uploads/`, and clients only ever see `/api/media/:id/...` URLs.
- **No arbitrary execution:** LibreOffice and "Open in PowerPoint" run fixed binaries with `execFile`/`spawn` (no shell) on files tracked in the database.
- **Resilience:** the display keeps its last frame when disconnected, reconnects forever and restores state exactly. State is persisted (survives restarts), interrupted conversions and cloud uploads resume on start, and missing local files are restored from the cloud. Speaker notes are never sent to displays, and a test checks this.

---

## Roadmap

**Phase 1 — MVP ✅** Local web app, cloud storage (Supabase), authentication, uploads, presentation library, PDF support, display page, realtime slide control, next/previous, fullscreen, live preview.

**Phase 2 ✅** PPT/PPTX conversion, Show Flow with drag-and-drop and slide ranges, Please Wait / Black / Technical Difficulty screens, logo overlay, countdown timer, keyboard shortcuts. Custom screens, video playback and basic animations from Phase 3 are also in.

**Phase 3 — next**
- Overlays: lower thirds, speaker names, announcements tickers
- Multiple outputs: Display 1 / Display 2 / confidence monitor (speaker's view with notes and next slide)
- Remote control from a phone or tablet (the REST control API is ready)
- Event presets: save/load a whole event (files, flow, screens, branding), with metadata synced to the cloud so any laptop can run it
- Audio / background music, configurable timer styles, configurable shortcuts
- Electron desktop app; Raspberry Pi display node

---

## Screenshots

| | |
| --- | --- |
| **Projector: Session Starting Soon with countdown** ![Starting soon](docs/screenshots/display-countdown.jpg) | **Projector: We'll Be Back Shortly** ![Break](docs/screenshots/display-break.jpg) |
| **Projector: Technical Difficulty** ![Technical](docs/screenshots/display-technical.jpg) | **Projector: Thank You** ![Thank you](docs/screenshots/display-thanks.jpg) |
| **Projector: converted PowerPoint slide + logo overlay + timer** ![Slide](docs/screenshots/display-pptx-slide.png) | **Preview a deck privately** ![Preview](docs/screenshots/preview.png) |
| **First run: operator password** ![First run](docs/screenshots/first-run.png) | **Events** ![Events](docs/screenshots/events.png) |

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| A PowerPoint card says "Install LibreOffice…" | Install LibreOffice, then **⋯ → Retry slide conversion** (or restart the app). Or upload a PDF export of the deck. |
| "Could not convert this presentation" | Open it in PowerPoint and **Save As → PDF**, then upload the PDF. |
| Forgot the operator password | Stop the app, run `npm run reset-password`, open the dashboard and choose a new one. |
| Status bar shows **CLOUD OFFLINE** | No internet, or wrong Supabase settings (hover the pill for details). The show keeps running from local copies; uploads sync when it's back. |
| `EADDRINUSE :4000` | EventControl is already running in another window. |
| Video plays muted on the display | Click the display window once (browser autoplay policy). |
| "The display blocked fullscreen" | Click the display window once, or press `F` there. |
| The projector PC can't connect | Allow ports 5173/4000 in the firewall and use the LAN address printed by the server. |
