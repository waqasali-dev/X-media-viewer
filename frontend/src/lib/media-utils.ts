import type { DownloadVariant, MediaItem } from "@/lib/x/types";
import { getApiUrl } from "@/lib/api-client";

export type MediaFilter = "all" | "photo" | "video";
export type SortOrder = "newest" | "oldest";

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, opts);
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

function slugLabel(label: string): string {
  const m = label.match(/(\d{3,4}p)/i) || label.match(/^(Original|Large|Medium|GIF)/i);
  return (m ? m[1] : label).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extFor(variant: DownloadVariant): string {
  if (variant.format === "video/mp4") return "mp4";
  if (variant.format === "image/jpeg") return "jpg";
  if (variant.format.startsWith("image/")) return variant.format.split("/")[1];
  return "bin";
}

export function downloadFilename(item: MediaItem, variant: DownloadVariant): string {
  const date = item.created_at.slice(0, 10);
  return `${item.username}_${date}_${item.tweet_id}_${slugLabel(variant.label)}.${extFor(variant)}`;
}

/** URL of the CORS-safe download proxy for a given variant. */
export function downloadHref(item: MediaItem, variant: DownloadVariant): string {
  const params = new URLSearchParams({ url: variant.url, filename: downloadFilename(item, variant) });
  return getApiUrl(`/api/download?${params.toString()}`);
}

/** URL of the CORS-safe inline streaming proxy for video/audio playback. */
export function mediaStreamHref(url: string | null | undefined): string {
  if (!url) return "";
  const params = new URLSearchParams({ url, inline: "1" });
  return getApiUrl(`/api/download?${params.toString()}`);
}

/** Highest-bitrate MP4 (videos / GIFs). */
export function bestMp4(item: MediaItem): string | null {
  const mp4s = item.download_variants.filter((v) => v.format === "video/mp4");
  if (!mp4s.length) return null;
  return [...mp4s].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0].url;
}

/** Best photo URL for the lightbox (large), falling back to display_url. */
export function largeImageUrl(item: MediaItem): string {
  return item.download_variants.find((v) => /large/i.test(v.label))?.url ?? item.display_url;
}

export function columnsForWidth(width: number): number {
  if (width < 520) return 2;
  if (width < 900) return 3;
  if (width < 1280) return 4;
  if (width < 1700) return 5;
  return 6;
}

export function aspectRatio(item: MediaItem): number {
  const r = item.width > 0 && item.height > 0 ? item.height / item.width : 1;
  return Math.min(1.6, Math.max(0.56, r));
}

export function matchesFilter(item: MediaItem, filter: MediaFilter): boolean {
  if (filter === "all") return true;
  if (filter === "photo") return item.type === "photo";
  return item.type !== "photo";
}
