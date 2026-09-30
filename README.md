# X Media Archive — No-API Infinite Stream Gallery

Full-stack Next.js app that takes an X.com handle or profile URL, discovers **every photo, video and GIF** the profile has ever posted, and shows it in a virtualized, infinite-scroll masonry gallery with in-app playback and per-quality downloads.

- **No official API.** The ingestion worker replays the web client's internal `UserMedia` GraphQL timeline through a pool of logged-in cookie sessions (`auth_token` + `ct0`). A headless Playwright-stealth mode is available as a fallback.
- **Nothing is downloaded automatically.** Thumbnails, HLS/MP4 playback and avatars stream straight from `pbs.twimg.com` / `video.twimg.com`. Only metadata (URLs, captions, sizes) is cached in PostgreSQL so a returning visit loads instantly and only fetches newer posts.
- **On-demand quality downloads** via a CORS-safe proxy (`/api/download`) that streams the CDN file with `Content-Disposition: attachment`.

```
[ @handle ] → /api/stream (SSE) → session pool → x.com/i/api/graphql/…/UserMedia
                                   │                (or Playwright intercepts responses)
                                   ▼
                        parser → PostgreSQL cache → JSON events chunk-by-chunk
                                   ▼
        React: TanStack-virtualized masonry → lightbox (hls.js) → /api/download?url=&filename=
```

---

## 1. Run it

### Node runtime (dev)

```bash
cp .env.example .env            # set DATABASE_URL
npm install
npx drizzle-kit push            # create tables
npm run dev                     # http://localhost:3000
```

### Docker

```bash
docker compose up --build       # app on :3000, postgres on :5432
```

Put your sessions in `cookies.json` (see below) before starting, or add them in the UI afterwards.

---

## 2. Getting `auth_token` and `ct0` cookies

Use a spare / burner account — heavy scraping can get an account rate-limited or locked.

1. Log in to **https://x.com** in Chrome, Edge or Firefox.
2. Open DevTools (`F12` / `Cmd+Opt+I`).
3. Chrome/Edge: **Application → Storage → Cookies → https://x.com**. Firefox: **Storage → Cookies → https://x.com**.
4. Find the row named **`auth_token`** and copy its **Value** (40 hexadecimal characters).
5. Find the row named **`ct0`** and copy its Value (long hex string; this is the CSRF token).
6. Either
   - open the app → **Sessions** → paste both values (or paste the whole `Cookie:` request header from the Network tab — it is parsed automatically), or
   - create `cookies.json` in the project root:

```json
[
  { "label": "burner-1", "auth_token": "0123456789abcdef0123456789abcdef01234567", "ct0": "…" },
  { "label": "burner-2", "auth_token": "…", "ct0": "…" }
]
```

`cookies.json` (or `X_COOKIES_FILE`) is imported into the pool automatically; you can also pass `X_AUTH_TOKEN` / `X_CT0` or `X_COOKIES_JSON` as environment variables.

Tip: the `ct0` value changes occasionally. If X answers with a CSRF error the worker picks up the refreshed `ct0` from the response cookies and updates the pool by itself. If a session is marked *invalid*, log in again and paste the new pair.

---

## 3. How ingestion works

| Step | What happens |
| --- | --- |
| Input | `@handle`, `x.com/handle`, `twitter.com/handle/media?s=20` … are normalized to a clean handle. |
| Cache check | If the profile was scraped before, all cached rows are streamed to the client immediately (`source: "cache"`). |
| Resolve | `UserByScreenName` → numeric user id, avatar, creation date, media count. |
| Paginate | `UserMedia(userId, count, cursor)` follows `cursor-bottom` until no cursor is returned. Incremental runs stop at the first page without new items; interrupted crawls resume from the persisted `resume_cursor`. |
| Parse | `legacy.extended_entities.media[]` → photos (`?format=jpg&name=orig/large/medium/small`) and videos (`.m3u8` for streaming + MP4 variants sorted by bitrate → 1080p/720p/480p/360p labels). |
| Stream | Each batch is pushed over SSE as `{ "type": "media", "items": [...] }`; progress, cooldown and errors are separate events. |
| Anti-detection | Rotating User-Agent / `sec-ch-ua`, signed `x-client-transaction-id` (generated in-process), 1.2–2.8 s jitter between pages, session rotation + 60 s cooldown on HTTP 429 (`{"status":"cooling_down","wait_seconds":60}`), automatic recovery of rotated GraphQL query ids and missing feature flags. |

### Scraper modes (`X_SCRAPER_MODE`)

- `auto` (default) — GraphQL worker first, Playwright fallback if X blocks it.
- `graphql` — GraphQL only.
- `playwright` — headless Chromium opens `https://x.com/{user}/media`, scrolls with jitter and captures every `UserMedia` response (`page.on('response')`). Requires a browser: `npx playwright install chromium` **or** `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium`.

You can also force a mode per request: `/api/stream?username=nasa&mode=playwright`.

---

## 4. HTTP API

| Route | Description |
| --- | --- |
| `GET /api/stream?username=<handle>` (alias `GET /api/stream/:username`) | Server-Sent Events. Query params: `mode=auto\|graphql\|playwright`, `full=1` (re-walk the whole timeline). |
| `GET /api/download?url=<encoded twimg url>&filename=<name>` | CORS-bypass proxy → `Content-Disposition: attachment; filename="nasa_2024-05-12_1780000000000000000_1080p.mp4"`. Only `*.twimg.com` hosts are allowed. Range requests are forwarded. |
| `GET /api/sessions` / `POST /api/sessions` / `DELETE /api/sessions?id=` | Cookie pool management (`{label, auth_token, ct0}`, `{cookie_string}`, `{action:"import"}`, `{action:"reset", id}`). |
| `GET /api/profiles` | Recently archived profiles. `?username=x&media=1&type=photo&order=oldest&offset=0&limit=200` pages the cache as JSON. |
| `DELETE /api/profiles?username=x` | Purge a cached archive. |
| `GET /api/health` | Database health check. |

### SSE event shapes

```jsonc
{ "type": "status",   "status": "checking_cache|cache_hit|resolving|scraping|cooling_down|done|error", "message": "…", "wait_seconds": 60, "mode": "graphql" }
{ "type": "profile",  "profile": { "user_id": "…", "username": "nasa", "media_count": 12345, "created_at": "2007-12-19T20:20:32.000Z", … } }
{ "type": "media",    "source": "cache|live", "items": [ MediaItem, … ] }
{ "type": "progress", "total": 1420, "page": 15, "new_items": 100, "mode": "graphql" }
{ "type": "done",     "total": 1420, "fully_scraped": true }
{ "type": "error",    "code": "no_sessions|not_found|…", "message": "…" }
```

`MediaItem` follows the contract in the spec (`id`, `tweet_id`, `username`, `created_at`, `type`, `caption`, `original_post_url`, `display_url`, `thumbnail_url`, `video_stream_url`, `download_variants[]`) plus `width`, `height`, `duration_ms` and `preview_url` (lowest-bitrate MP4 for hover loops).

---

## 5. Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string. |
| `X_COOKIES_FILE` | `./cookies.json` | Session pool file. |
| `X_COOKIES_JSON`, `X_AUTH_TOKEN`, `X_CT0` | — | Inline sessions. |
| `X_SCRAPER_MODE` | `auto` | `auto` / `graphql` / `playwright`. |
| `X_PAGE_SIZE` | `100` | Items per `UserMedia` request (20–100). |
| `X_COOLDOWN_SECONDS` | `60` | Pause applied to a session after HTTP 429. |
| `X_OP_USER_MEDIA`, `X_OP_USER_BY_SCREEN_NAME`, `X_OP_USER_BY_REST_ID` | built-in | Override GraphQL query ids (they are also auto-refreshed from x.com's bundle on 404). |
| `PLAYWRIGHT_CHROMIUM_PATH` | — | Chromium/Chrome binary for the Playwright fallback. |

---

## 6. Project layout

```
src/
  app/
    api/stream/route.ts, api/stream/[username]/route.ts   SSE ingestion endpoint
    api/download/route.ts                                 CORS-safe download proxy
    api/sessions/route.ts                                 cookie pool CRUD
    api/profiles/route.ts                                 cached archives / JSON paging
  lib/x/
    constants.ts        bearer token, operation ids, feature flags, UA rotation, handle normalizer
    session-pool.ts     cookies.json + env + DB pool, LRU rotation, cooldown / invalidation
    client.ts           GraphQL request pipeline (transaction ids, 429/403/404/400 handling)
    parser.ts           UserMedia / UserByScreenName → normalized MediaItem records
    scraper.ts          cache-first, incremental & resumable pagination orchestrator
    playwright-fallback.ts  Mode B – stealth Chromium response interception
    repository.ts       Drizzle queries
  components/           ArchiveApp, MediaGrid (TanStack Virtual masonry), MediaCard, Lightbox, VideoPlayer (hls.js), DownloadMenu, SessionManager
  hooks/useMediaStream.ts   EventSource consumer
  db/schema.ts          profiles, media_items, x_sessions
```

> Legal note: scraping may violate X's Terms of Service. Use your own accounts, respect rate limits and only archive content you are allowed to access.
