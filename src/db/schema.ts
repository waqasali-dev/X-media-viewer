import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { DownloadVariant } from "@/lib/x/types";

/**
 * A scraped X.com profile. Holds the incremental-scrape state so that returning
 * to a handle only fetches posts published after the last run (or resumes a
 * previously interrupted backwards crawl through `resumeCursor`).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: serial("id").primaryKey(),
    username: text("username").notNull(), // lower-cased handle
    displayName: text("display_name"),
    userId: text("user_id"), // X numeric rest_id
    avatarUrl: text("avatar_url"),
    bio: text("bio"),
    accountCreatedAt: timestamp("account_created_at", { withTimezone: true }),
    mediaCount: integer("media_count").default(0).notNull(), // reported by X
    followersCount: integer("followers_count").default(0).notNull(),
    isProtected: boolean("is_protected").default(false).notNull(),
    totalMedia: integer("total_media").default(0).notNull(), // cached rows
    fullyScraped: boolean("fully_scraped").default(false).notNull(),
    resumeCursor: text("resume_cursor"),
    newestTweetId: text("newest_tweet_id"),
    oldestTweetId: text("oldest_tweet_id"),
    lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("profiles_username_idx").on(t.username)],
);

/**
 * One row per media attachment (a tweet with 4 photos yields 4 rows).
 * Nothing is downloaded: every URL points straight at X's CDN.
 */
export const mediaItems = pgTable(
  "media_items",
  {
    id: text("id").primaryKey(), // `${tweetId}_${mediaId}`
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tweetId: text("tweet_id").notNull(),
    mediaKey: text("media_key").notNull(),
    username: text("username").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    type: text("type").notNull(), // photo | video | animated_gif
    caption: text("caption").default("").notNull(),
    originalPostUrl: text("original_post_url").notNull(),
    displayUrl: text("display_url").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    videoStreamUrl: text("video_stream_url"),
    previewUrl: text("preview_url"),
    width: integer("width").default(0).notNull(),
    height: integer("height").default(0).notNull(),
    durationMs: integer("duration_ms"),
    downloadVariants: jsonb("download_variants").$type<DownloadVariant[]>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("media_items_profile_posted_idx").on(t.profileId, t.postedAt),
    index("media_items_tweet_idx").on(t.tweetId),
    index("media_items_profile_type_idx").on(t.profileId, t.type),
  ],
);

/**
 * Cookie session pool. Each row is one logged-in X account (auth_token + ct0).
 * Sessions are rotated round-robin and parked in cooldown on HTTP 429.
 */
export const xSessions = pgTable(
  "x_sessions",
  {
    id: serial("id").primaryKey(),
    label: text("label").notNull(),
    authToken: text("auth_token").notNull(),
    ct0: text("ct0").notNull(),
    userAgent: text("user_agent"),
    status: text("status").default("active").notNull(), // active | cooldown | invalid
    cooldownUntil: timestamp("cooldown_until", { withTimezone: true }),
    requestsCount: integer("requests_count").default(0).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("x_sessions_auth_token_idx").on(t.authToken)],
);

export type ProfileRow = typeof profiles.$inferSelect;
export type MediaItemRow = typeof mediaItems.$inferSelect;
export type NewMediaItemRow = typeof mediaItems.$inferInsert;
export type XSessionRow = typeof xSessions.$inferSelect;
