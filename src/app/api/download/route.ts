import { ALLOWED_DOWNLOAD_HOSTS, BROWSER_PROFILES } from "@/lib/x/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range, Accept, Origin",
      "Access-Control-Max-Age": "86400",
    },
  });
}

/**
 * GET /api/download?url=<encoded twimg url>&filename=<name>&inline=1
 * Streams the remote CDN file straight through to the browser.
 * With inline=1, sets Content-Disposition: inline with range support for video playback.
 * Otherwise, sets Content-Disposition: attachment to trigger downloads.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("url");
  if (!raw) return Response.json({ error: "Missing url parameter" }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return Response.json({ error: "Invalid url" }, { status: 400 });
  }
  const hostAllowed =
    target.protocol === "https:" &&
    (ALLOWED_DOWNLOAD_HOSTS.includes(target.hostname) || target.hostname.endsWith(".twimg.com"));
  if (!hostAllowed) return Response.json({ error: "Only twimg.com media can be proxied" }, { status: 403 });

  const range = request.headers.get("range");
  const fp = BROWSER_PROFILES[0];
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        "user-agent": fp.ua,
        referer: "https://x.com/",
        accept: "*/*",
        ...(range ? { range } : {}),
      },
      signal: request.signal,
      redirect: "follow",
    });
  } catch (err) {
    return Response.json({ error: `Upstream fetch failed: ${(err as Error).message}` }, { status: 502 });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: `X CDN responded with ${upstream.status}` }, { status: 502 });
  }

  const mime = upstream.headers.get("content-type")?.split(";")[0] || guessMime(target);
  const urlExt = target.searchParams.get("format") || target.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1];
  const ext = EXT_BY_MIME[mime.toLowerCase()] || urlExt || "bin";
  let filename = sanitizeFilename(searchParams.get("filename") || target.pathname.split("/").pop() || "media");
  if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename = `${filename}.${ext}`;

  const isInline = searchParams.get("inline") === "1";
  const disposition = isInline
    ? "inline"
    : `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;

  const headers = new Headers({
    "Content-Type": mime,
    "Content-Disposition": disposition,
    "Cache-Control": isInline ? "public, max-age=3600" : "private, max-age=0",
    "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
    "Access-Control-Allow-Origin": "*",
  });
  for (const h of ["content-length", "content-range", "last-modified", "etag"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
