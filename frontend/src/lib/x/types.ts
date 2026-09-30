/** Shared data contract between backend and frontend. */

export type MediaType = "photo" | "video" | "animated_gif";

export interface DownloadVariant {
  label: string; // e.g. "Original (Source Quality)", "1080p (Full HD)"
  url: string; // direct pbs.twimg.com / video.twimg.com URL
  format: string; // MIME type: image/jpeg, video/mp4 ...
  bitrate?: number;
  width?: number;
  height?: number;
}

export interface MediaItem {
  id: string; // `${tweet_id}_${media_id}`
  tweet_id: string;
  username: string;
  created_at: string; // ISO-8601
  type: MediaType;
  caption: string;
  original_post_url: string;
  display_url: string; // medium photo / video poster
  thumbnail_url: string; // small photo / video poster
  video_stream_url: string | null; // .m3u8 (preferred) or lowest bitrate mp4
  preview_url: string | null; // lowest bitrate mp4 for muted hover loops
  width: number;
  height: number;
  duration_ms: number | null;
  download_variants: DownloadVariant[];
}

export interface ProfileInfo {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  bio: string;
  created_at: string | null;
  media_count: number;
  followers_count: number;
  is_protected: boolean;
}

export interface ProfileState extends ProfileInfo {
  total_cached: number;
  fully_scraped: boolean;
  last_scraped_at: string | null;
}

export type StreamStatus =
  | "checking_cache"
  | "cache_hit"
  | "resolving"
  | "scraping"
  | "cooling_down"
  | "done"
  | "error";

export type StreamEvent =
  | { type: "status"; status: StreamStatus; message?: string; wait_seconds?: number; mode?: "graphql" | "playwright" }
  | { type: "profile"; profile: ProfileState }
  | { type: "media"; items: MediaItem[]; source: "cache" | "live" }
  | { type: "progress"; total: number; page: number; new_items: number; mode: "graphql" | "playwright" }
  | { type: "done"; total: number; fully_scraped: boolean; message?: string }
  | { type: "error"; message: string; code?: string };

export interface SessionCookie {
  id: number;
  label: string;
  authToken: string;
  ct0: string;
  userAgent: string | null;
}
