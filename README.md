# X Media Archive — High-Performance Media Stream Gallery

Discover, stream, and archive **every photo, video, and animated GIF** an X.com (Twitter) profile has ever posted without official API limits. Features an infinite-scroll virtualized masonry gallery, HLS/MP4 video playback, multi-account session rotation, and one-click quality downloads.

---

## Architecture

The project is decoupled into two independent services:

```
x-profile-media-archive/
├── backend/            # Express server (Deploy to Render)
│   ├── src/            # SSE streaming, GraphQL timeline client, session & in-memory media cache
│   ├── cookies.json    # Local cookie persistence
│   ├── render.yaml     # Render Blueprint
│   └── package.json
├── frontend/           # Next.js 16 & React 19 App (Deploy to Vercel)
│   ├── src/            # Gallery UI, VideoPlayer, Lightbox, SessionManager
│   ├── vercel.json     # Vercel configuration
│   └── package.json
└── start.bat           # One-click Windows local launcher
```

- **Zero Database**: Operates completely in-memory with automatic session persistence to `cookies.json`. No PostgreSQL or SQL database required!
- **Session Pool & Cache**: Automatically rotates multiple X accounts (`auth_token` + `ct0`) to evade rate limits with 429 backoff handling.
- **Video & CDN Proxy**: Proxies media through `/api/download` with HTTP Range requests, enabling smooth seekable video streaming and quality selection.

---

## Local Development

### Quick Start (Windows)
Double-click or run:
```bat
start.bat
```
This launches:
- **Backend**: `http://localhost:4000`
- **Frontend**: `http://localhost:3000`

### Manual Start

#### 1. Backend
```bash
cd backend
npm install
npm run dev
```

#### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## Deployment Guide

### Deploy Backend on Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect your Git repository.
3. Configure the service settings:
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Set Environment Variables (optional):
   - `X_COOKIES_JSON`: `[{"label":"burner-1","auth_token":"...","ct0":"..."}]`
   - `X_SCRAPER_MODE`: `auto`
5. Note your assigned Render URL (e.g. `https://x-media-archive-backend.onrender.com`).

*(Alternatively, use Render Blueprints with `backend/render.yaml` for 1-click infrastructure deployment.)*

---

### Deploy Frontend on Vercel

1. Import your Git repository into [Vercel](https://vercel.com).
2. Set the **Root Directory** to `frontend`.
3. Under **Environment Variables**, add:
   - `NEXT_PUBLIC_BACKEND_URL` = `https://x-media-archive-backend.onrender.com` (your Render backend URL)
4. Click **Deploy**.

---

## Session Configuration

To scrape timelines, configure at least one active X session:

1. Log into **https://x.com** in your browser.
2. Open DevTools (`F12`) → **Application** (or **Storage**) → **Cookies** → `https://x.com`.
3. Copy:
   - `auth_token` (40-char hex string)
   - `ct0` (CSRF token string)
4. Add it through the in-app **Sessions** modal (`http://localhost:3000`), or add it to `backend/cookies.json`.
