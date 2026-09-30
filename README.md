# X Media Archive — High-Performance Media Stream Gallery

Discover, stream, and archive **every photo, video, and animated GIF** an X.com (Twitter) profile has ever posted without official API limits. Features an infinite-scroll virtualized masonry gallery, HLS/MP4 video playback, private browser-cached session rotation, and one-click quality downloads.

---

## Architecture

The project is decoupled into two independent standalone services:

```
x-profile-media-archive/
├── backend/            # Express server (Deploy to Render)
│   ├── src/            # SSE streaming, GraphQL timeline client, in-memory cache & media proxy
│   ├── package.json
│   └── tsconfig.json
├── frontend/           # Next.js 16 & React 19 App (Deploy to Vercel)
│   ├── src/            # Gallery UI, VideoPlayer, Lightbox, Private Session Store
│   ├── vercel.json     # Vercel configuration
│   └── package.json
├── render.yaml         # Render Blueprint specification
├── start.bat           # One-click Windows local launcher
└── README.md
```

- **Zero Database & Zero Disk Storage**: Operates completely in-memory with request-scoped sessions. No PostgreSQL or database required!
- **Private Browser Cache**: User credentials (`auth_token` + `ct0`) are saved strictly in the user's private browser `localStorage`. No cookies are ever saved on the server or shared with other visitors.
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

### 1. Deploy Backend on Render

#### Option A: 1-Click Render Blueprint (Recommended)
1. In [Render Dashboard](https://dashboard.render.com), click **New +** → **Blueprint**.
2. Connect your Git repository.
3. Render automatically detects `render.yaml` at the root and configures the service:
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/api/health`
4. Click **Apply**.
5. Once deployed, copy your service URL (e.g. `https://x-media-archive-backend.onrender.com`).

#### Option B: Manual Web Service on Render
1. Click **New +** → **Web Service**.
2. Connect your repository.
3. Settings:
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free
4. Add Environment Variables:
   - `PORT`: `10000`
   - `NODE_ENV`: `production`
   - `X_SCRAPER_MODE`: `auto`

---

### 2. Deploy Frontend on Vercel

1. Go to [Vercel Dashboard](https://vercel.com) and click **Add New...** → **Project**.
2. Import your Git repository.
3. Configure Project Settings:
   - **Framework Preset**: `Next.js`
   - **Root Directory**: Click **Edit** and select `frontend`.
4. Configure Environment Variables:
   - Key: `NEXT_PUBLIC_BACKEND_URL`
   - Value: `https://x-media-archive-backend.onrender.com` *(replace with your Render backend URL)*
5. Click **Deploy**.

---

## Connecting Frontend to Backend

When your frontend loads in the browser:
- `NEXT_PUBLIC_BACKEND_URL` tells the frontend where the Render backend lives.
- All requests (SSE media stream, CDN proxy, profiles) connect directly to Render with full CORS support.
- Each visitor saves their own X credentials (`auth_token` and `ct0`) in their private browser cache via the top-bar **Sessions** modal.
