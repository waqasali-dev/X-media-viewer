import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { ALLOWED_DOWNLOAD_HOSTS, BROWSER_PROFILES, normalizeHandle } from "./lib/x/constants.js";
import { scrapeProfileMedia, type ScraperMode } from "./lib/x/scraper.js";
import {
  deleteProfile,
  getProfile,
  listRecentProfiles,
  profileToState,
  queryCachedMedia,
} from "./lib/x/cache-repository.js";
import {
  addSession,
  deleteSession,
  getSessionOverview,
  resetSession,
  syncExternalSessions,
} from "./lib/x/session-cache.js";
import type { MediaType } from "./lib/x/types.js";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Enable CORS for Vercel frontend or any origin
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Range", "Accept", "Content-Type", "Origin", "Authorization"],
    exposedHeaders: [
      "Content-Range",
      "Accept-Ranges",
      "Content-Length",
      "Content-Type",
      "Content-Disposition",
    ],
  }),
);

app.use(express.json());

// Initial session sync on startup
void syncExternalSessions(true).then((count) => {
  console.log(`[backend] Loaded ${count} initial X sessions into cache`);
});

/**
 * Health Check Endpoint
 * GET /api/health
 */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "x-profile-media-archive-backend",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Server-Sent Events (SSE) Stream Endpoint
 * GET /api/stream?username=<handle|url>[&mode=auto|graphql|playwright][&full=1]
 * GET /api/stream/:username
 */
app.get(["/api/stream", "/api/stream/:username"], async (req: Request, res: Response) => {
  const username = (req.params.username || req.query.username || req.query.u || "").toString();

  if (!username) {
    res.status(400).json({ error: "Missing username parameter" });
    return;
  }

  const modeParam = req.query.mode?.toString();
  const mode: ScraperMode | undefined =
    modeParam === "graphql" || modeParam === "playwright" || modeParam === "auto" ? modeParam : undefined;
  const full = req.query.full === "1" || req.query.full === "true";

  // Setup SSE Headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const abort = new AbortController();
  req.on("close", () => {
    abort.abort();
  });

  const sendEvent = (event: unknown) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  // Heartbeat ping every 15s to keep connections alive through Render / Vercel proxies
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: ping ${Date.now()}\n\n`);
    }
  }, 15_000);

  res.write(`retry: 5000\n\n`);

  try {
    for await (const event of scrapeProfileMedia(username, {
      signal: abort.signal,
      mode,
      full,
    })) {
      if (abort.signal.aborted || res.writableEnded) break;
      sendEvent(event);
    }
  } catch (err) {
    sendEvent({
      type: "error",
      code: "stream_crashed",
      message: (err as Error).message || "Stream crashed",
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      res.end();
    }
  }
});

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "application/x-mpegurl": "m3u8",
  "application/vnd.apple.mpegurl": "m3u8",
};

function guessMime(url: URL): string {
  const format = url.searchParams.get("format");
  if (format) return format === "jpg" ? "image/jpeg" : `image/${format}`;
  const ext = url.pathname.split(".").pop()?.toLowerCase();
  if (ext === "mp4") return "video/mp4";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "m3u8") return "application/vnd.apple.mpegurl";
  return "application/octet-stream";
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

/**
 * Media Proxy Endpoint (Streams images & range-supported videos for seamless HTML5 video seeking)
 * GET /api/download?url=<encoded twimg url>&filename=<name>&inline=1
 */
app.get("/api/download", async (req: Request, res: Response) => {
  const rawUrl = req.query.url?.toString();
  if (!rawUrl) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    res.status(400).json({ error: "Invalid url" });
    return;
  }

  const hostAllowed =
    target.protocol === "https:" &&
    (ALLOWED_DOWNLOAD_HOSTS.includes(target.hostname) || target.hostname.endsWith(".twimg.com"));
  if (!hostAllowed) {
    res.status(403).json({ error: "Only twimg.com media can be proxied" });
    return;
  }

  const range = req.headers.range;
  const fp = BROWSER_PROFILES[0];
  const abort = new AbortController();
  req.on("close", () => abort.abort());

  try {
    const upstream = await fetch(target, {
      headers: {
        "user-agent": fp.ua,
        referer: "https://x.com/",
        accept: "*/*",
        ...(range ? { range } : {}),
      },
      signal: abort.signal,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ error: `X CDN responded with ${upstream.status}` });
      return;
    }

    const mime = upstream.headers.get("content-type")?.split(";")[0] || guessMime(target);
    const urlExt = target.searchParams.get("format") || target.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
    const ext = EXT_BY_MIME[mime.toLowerCase()] || urlExt || "bin";
    let filename = sanitizeFilename(req.query.filename?.toString() || target.pathname.split("/").pop() || "media");
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename = `${filename}.${ext}`;

    const isInline = req.query.inline === "1";
    const disposition = isInline
      ? "inline"
      : `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

    res.status(upstream.status);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", disposition);
    res.setHeader("Cache-Control", isInline ? "public, max-age=3600" : "private, max-age=0");
    res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
    res.setHeader("Access-Control-Allow-Origin", "*");

    for (const h of ["content-length", "content-range", "last-modified", "etag"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    // Pipe stream directly to Express response
    // Node 18+ Web ReadableStream to Node WritableStream
    const reader = upstream.body.getReader();
    const pump = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          if (res.writableEnded) {
            await reader.cancel();
            break;
          }
          const canContinue = res.write(value);
          if (!canContinue) {
            await new Promise((resolve) => res.once("drain", resolve));
          }
        }
      } catch (streamErr) {
        if (!res.writableEnded) {
          res.end();
        }
      }
    };
    void pump();
  } catch (err) {
    if (!res.headersSent) {
      res.status(502).json({ error: `Upstream fetch failed: ${(err as Error).message}` });
    }
  }
});

/**
 * Profiles Endpoints
 * GET /api/profiles                      → recently archived profiles
 * GET /api/profiles?username=x&media=1   → paginated cached media (&type=&order=&offset=&limit=)
 */
app.get("/api/profiles", async (req: Request, res: Response) => {
  try {
    const username = req.query.username?.toString();
    if (!username) {
      const profiles = await listRecentProfiles(30);
      res.json({ profiles });
      return;
    }

    const handle = normalizeHandle(username);
    if (!handle) {
      res.status(400).json({ error: "Invalid handle" });
      return;
    }

    const profile = await getProfile(handle);
    if (!profile) {
      res.status(404).json({ error: "Profile not cached yet" });
      return;
    }

    if (req.query.media !== "1") {
      res.json({ profile: profileToState(profile) });
      return;
    }

    const type = (req.query.type as MediaType | "all" | undefined) ?? "all";
    const order = req.query.order === "oldest" ? "oldest" : "newest";
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

    const result = await queryCachedMedia({
      profileId: profile.id,
      type,
      order,
      offset,
      limit,
    });

    res.json({
      profile: profileToState(profile),
      ...result,
      offset,
      limit,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * Purge cached profile
 * DELETE /api/profiles?username=x
 */
app.delete("/api/profiles", async (req: Request, res: Response) => {
  try {
    const handle = normalizeHandle(req.query.username?.toString() ?? "");
    if (!handle) {
      res.status(400).json({ error: "Invalid handle" });
      return;
    }
    await deleteProfile(handle);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function parseCookieString(input: string): { authToken?: string; ct0?: string } {
  const authToken = input.match(/auth_token=([0-9a-f]{20,})/i)?.[1];
  const ct0 = input.match(/ct0=([0-9a-f]{16,})/i)?.[1];
  return { authToken, ct0 };
}

/**
 * Session Pool Endpoints
 * GET /api/sessions – list the cookie pool (tokens are masked)
 */
app.get("/api/sessions", async (_req: Request, res: Response) => {
  try {
    const overview = await getSessionOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * POST /api/sessions
 *   { label?, auth_token, ct0 }            → add / update a session
 *   { cookie_string }                      → parse a pasted cookie header
 *   { action: "import" }                   → re-import cookies.json / env
 *   { action: "reset", id }                → clear cooldown / invalid flag
 */
app.post("/api/sessions", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    if (body.action === "import") {
      const imported = await syncExternalSessions(true);
      const overview = await getSessionOverview();
      res.json({ imported, ...overview });
      return;
    }

    if (body.action === "reset" && typeof body.id === "number") {
      await resetSession(body.id);
      const overview = await getSessionOverview();
      res.json(overview);
      return;
    }

    let authToken = typeof body.auth_token === "string" ? body.auth_token.trim() : "";
    let ct0 = typeof body.ct0 === "string" ? body.ct0.trim() : "";
    if (typeof body.cookie_string === "string" && (!authToken || !ct0)) {
      const parsed = parseCookieString(body.cookie_string);
      authToken ||= parsed.authToken ?? "";
      ct0 ||= parsed.ct0 ?? "";
    }

    authToken = authToken.replace(/^auth_token=/i, "").replace(/;.*$/, "");
    ct0 = ct0.replace(/^ct0=/i, "").replace(/;.*$/, "");

    if (!/^[0-9a-f]{20,}$/i.test(authToken)) {
      res.status(400).json({ error: "auth_token looks invalid – it should be a 40-character hex string." });
      return;
    }
    if (!/^[0-9a-f]{16,}$/i.test(ct0)) {
      res.status(400).json({ error: "ct0 looks invalid – copy the full value of the ct0 cookie." });
      return;
    }

    const session = await addSession({
      label: typeof body.label === "string" ? body.label : undefined,
      authToken,
      ct0,
      userAgent: typeof body.user_agent === "string" ? body.user_agent : undefined,
    });

    const overview = await getSessionOverview();
    res.json({ added: session.id, ...overview });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * DELETE /api/sessions?id=123
 */
app.delete("/api/sessions", async (req: Request, res: Response) => {
  try {
    const id = Number(req.query.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: "id required" });
      return;
    }
    await deleteSession(id);
    const overview = await getSessionOverview();
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[backend] X Media Archive Backend running on http://0.0.0.0:${PORT}`);
});
