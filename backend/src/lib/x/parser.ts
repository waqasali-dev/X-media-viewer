import type { DownloadVariant, MediaItem, MediaType, ProfileInfo } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function get(obj: Json, path: string): Json {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function findKey(obj: Json, key: string, depth = 0): Json {
  if (!obj || typeof obj !== "object" || depth > 12) return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  for (const value of Object.values(obj)) {
    const hit = findKey(value, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function parseTwitterDate(value: string | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type UserLookup =
  | { ok: true; profile: ProfileInfo }
  | { ok: false; reason: "not_found" | "unavailable"; message: string };

export function parseUserResult(json: Json): UserLookup {
  const result = get(json, "data.user.result") ?? get(json, "data.user_result.result");
  if (!result) return { ok: false, reason: "not_found", message: "This account does not exist." };
  if (result.__typename === "UserUnavailable") {
    return { ok: false, reason: "unavailable", message: result.message || result.reason || "This account is unavailable (suspended or withheld)." };
  }
  const legacy = result.legacy ?? {};
  const core = result.core ?? {};
  const screenName: string = core.screen_name ?? legacy.screen_name ?? "";
  return {
    ok: true,
    profile: {
      user_id: String(result.rest_id ?? result.id_str ?? ""),
      username: screenName,
      display_name: core.name ?? legacy.name ?? screenName,
      avatar_url: (result.avatar?.image_url ?? legacy.profile_image_url_https ?? "").replace("_normal.", "_200x200."),
      bio: legacy.description ?? "",
      created_at: parseTwitterDate(core.created_at ?? legacy.created_at),
      media_count: Number(legacy.media_count ?? 0),
      followers_count: Number(legacy.followers_count ?? 0),
      is_protected: Boolean(result.privacy?.protected ?? legacy.protected ?? false),
    },
  };
}

const PHOTO_SIZES: { name: string; label: string }[] = [
  { name: "orig", label: "Original (Source Quality)" },
  { name: "large", label: "Large (2048px Web)" },
  { name: "medium", label: "Medium (1200px)" },
];

function splitPhotoUrl(url: string): { base: string; ext: string } {
  const clean = url.split("?")[0].replace(/:\w+$/, "");
  const m = clean.match(/^(.*)\.(\w+)$/);
  return m ? { base: m[1], ext: m[2].toLowerCase() } : { base: clean, ext: "jpg" };
}

export function photoUrl(mediaUrlHttps: string, name: "orig" | "large" | "medium" | "small" | "thumb"): string {
  const { base, ext } = splitPhotoUrl(mediaUrlHttps);
  return `${base}?format=${ext}&name=${name}`;
}

function mimeFor(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return `image/${ext}`;
}

export function labelForBitrate(bitrate: number, height?: number): string {
  if (height) {
    if (height >= 1080) return `${height}p (Full HD)`;
    if (height >= 720) return `${height}p (HD)`;
    return `${height}p`;
  }
  if (bitrate > 2_000_000) return "1080p (Full HD)";
  if (bitrate > 800_000) return "720p (HD)";
  if (bitrate > 250_000) return "480p";
  return "360p";
}

function videoDimensions(url: string): { width?: number; height?: number } {
  const m = url.match(/\/(\d{2,5})x(\d{2,5})\//);
  if (!m) return {};
  return { width: Number(m[1]), height: Number(m[2]) };
}

interface RawVariant {
  bitrate?: number;
  content_type?: string;
  url?: string;
}

function normalizeVideoVariants(variants: RawVariant[], isGif: boolean) {
  const m3u8 = variants.find((v) => v.content_type === "application/x-mpegURL" && v.url)?.url ?? null;
  const mp4s = variants
    .filter((v) => v.content_type === "video/mp4" && v.url)
    .map((v) => ({ url: v.url!, bitrate: Number(v.bitrate ?? 0), ...videoDimensions(v.url!) }))
    .sort((a, b) => b.bitrate - a.bitrate || (b.height ?? 0) - (a.height ?? 0));

  const seenLabels = new Set<string>();
  const download_variants: DownloadVariant[] = [];
  for (const v of mp4s) {
    let label = isGif && mp4s.length === 1 ? "GIF (MP4 Source)" : labelForBitrate(v.bitrate, v.height);
    while (seenLabels.has(label)) label = `${label} (alt)`;
    seenLabels.add(label);
    download_variants.push({ label, url: v.url, format: "video/mp4", bitrate: v.bitrate, width: v.width, height: v.height });
  }
  const lowest = mp4s[mp4s.length - 1]?.url ?? null;
  return { m3u8, lowest, download_variants };
}

function cleanCaption(text: string, mediaUrls: string[]): string {
  let caption = text ?? "";
  for (const u of mediaUrls) caption = caption.split(u).join("");
  return caption.replace(/\s+https:\/\/t\.co\/\w+\s*$/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function unwrapTweet(result: Json): Json | null {
  if (!result) return null;
  if (result.__typename === "TweetWithVisibilityResults") return result.tweet ?? null;
  if (result.__typename === "TweetTombstone" || result.__typename === "TweetUnavailable") return null;
  return result.legacy || result.rest_id ? result : null;
}

function* iterItemContents(instructions: Json[]): Generator<{ itemContent: Json; entryId?: string }> {
  for (const ins of instructions) {
    if (ins?.type === "TimelineAddEntries" || ins?.type === "TimelineReplaceEntry") {
      const entries = ins.entries ?? (ins.entry ? [ins.entry] : []);
      for (const entry of entries) yield* iterEntry(entry);
    } else if (ins?.type === "TimelineAddToModule") {
      for (const mi of ins.moduleItems ?? []) yield { itemContent: mi?.item?.itemContent, entryId: mi?.entryId };
    } else if (ins?.type === "TimelinePinEntry" && ins.entry) {
      yield* iterEntry(ins.entry);
    }
  }
}

function* iterEntry(entry: Json): Generator<{ itemContent: Json; entryId?: string }> {
  const content = entry?.content;
  if (!content) return;
  if (content.entryType === "TimelineTimelineModule" || content.__typename === "TimelineTimelineModule") {
    for (const item of content.items ?? []) yield { itemContent: item?.item?.itemContent, entryId: item?.entryId };
  } else if (content.itemContent) {
    yield { itemContent: content.itemContent, entryId: entry.entryId };
  }
}

function findBottomCursor(instructions: Json[]): string | null {
  for (const ins of instructions) {
    const entries: Json[] = ins?.entries ?? (ins?.entry ? [ins.entry] : []);
    for (const entry of entries) {
      const c = entry?.content;
      if (!c) continue;
      const isCursor = c.entryType === "TimelineTimelineCursor" || c.__typename === "TimelineTimelineCursor";
      if (isCursor && (c.cursorType === "Bottom" || String(entry.entryId).startsWith("cursor-bottom"))) return c.value ?? null;
    }
  }
  return null;
}

export interface ParsedPage {
  items: MediaItem[];
  bottomCursor: string | null;
  tweetCount: number;
  isEmpty: boolean;
}

function getInstructions(json: Json): Json[] {
  const candidates = [
    get(json, "data.user.result.timeline_v2.timeline.instructions"),
    get(json, "data.user.result.timeline.timeline.instructions"),
    get(json, "data.user_result.result.timeline_response.timeline.instructions"),
  ];
  for (const c of candidates) if (Array.isArray(c)) return c;
  const deep = findKey(json, "instructions");
  return Array.isArray(deep) ? deep : [];
}

export function parseUserMediaPage(json: Json, fallbackUsername: string): ParsedPage {
  const instructions = getInstructions(json);
  const items: MediaItem[] = [];
  const seen = new Set<string>();
  let tweetCount = 0;

  for (const { itemContent } of iterItemContents(instructions)) {
    if (!itemContent || itemContent.itemType !== "TimelineTweet") continue;
    const tweet = unwrapTweet(itemContent.tweet_results?.result);
    if (!tweet) continue;
    tweetCount++;
    for (const item of tweetToMediaItems(tweet, fallbackUsername)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }

  return {
    items,
    bottomCursor: findBottomCursor(instructions),
    tweetCount,
    isEmpty: tweetCount === 0,
  };
}

export function tweetToMediaItems(tweet: Json, fallbackUsername: string): MediaItem[] {
  const legacy = tweet.legacy ?? {};
  const tweetId: string = String(legacy.id_str ?? tweet.rest_id ?? "");
  if (!tweetId) return [];
  const userResult = tweet.core?.user_results?.result ?? {};
  const username: string =
    userResult.core?.screen_name ?? userResult.legacy?.screen_name ?? legacy.user?.screen_name ?? fallbackUsername;
  const createdAt = parseTwitterDate(legacy.created_at) ?? new Date().toISOString();
  const media: Json[] = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  if (!media.length) return [];

  const noteText: string | undefined = tweet.note_tweet?.note_tweet_results?.result?.text;
  const rawText: string = noteText ?? legacy.full_text ?? legacy.text ?? "";
  const caption = cleanCaption(
    rawText,
    media.map((m) => m.url).filter(Boolean),
  );
  const postUrl = `https://x.com/${username}/status/${tweetId}`;

  const out: MediaItem[] = [];
  for (const m of media) {
    const type = (m.type as MediaType) ?? "photo";
    const mediaId = String(m.id_str ?? m.media_key ?? out.length + 1);
    const src: string = m.media_url_https ?? m.media_url ?? "";
    if (!src) continue;
    const width = Number(m.original_info?.width ?? m.sizes?.large?.w ?? 0);
    const height = Number(m.original_info?.height ?? m.sizes?.large?.h ?? 0);

    if (type === "photo") {
      const { ext } = splitPhotoUrl(src);
      out.push({
        id: `${tweetId}_${mediaId}`,
        tweet_id: tweetId,
        username,
        created_at: createdAt,
        type,
        caption,
        original_post_url: postUrl,
        display_url: photoUrl(src, "medium"),
        thumbnail_url: photoUrl(src, "small"),
        video_stream_url: null,
        preview_url: null,
        width,
        height,
        duration_ms: null,
        download_variants: PHOTO_SIZES.map((s) => ({
          label: s.label,
          url: photoUrl(src, s.name as "orig"),
          format: mimeFor(ext),
          ...(s.name === "orig" ? { width, height } : {}),
        })),
      });
      continue;
    }

    const variants: RawVariant[] = m.video_info?.variants ?? [];
    const { m3u8, lowest, download_variants } = normalizeVideoVariants(variants, type === "animated_gif");
    const [arW, arH] = (m.video_info?.aspect_ratio as number[] | undefined) ?? [];
    out.push({
      id: `${tweetId}_${mediaId}`,
      tweet_id: tweetId,
      username,
      created_at: createdAt,
      type: type === "animated_gif" ? "animated_gif" : "video",
      caption,
      original_post_url: postUrl,
      display_url: src,
      thumbnail_url: src,
      video_stream_url: m3u8 ?? lowest,
      preview_url: lowest,
      width: width || arW || 0,
      height: height || arH || 0,
      duration_ms: m.video_info?.duration_millis != null ? Number(m.video_info.duration_millis) : null,
      download_variants,
    });
  }
  return out;
}
