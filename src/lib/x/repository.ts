import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaItems, profiles, type MediaItemRow, type ProfileRow } from "@/db/schema";
import type { MediaItem, MediaType, ProfileInfo, ProfileState } from "./types";

export function rowToMediaItem(row: MediaItemRow): MediaItem {
  return {
    id: row.id,
    tweet_id: row.tweetId,
    username: row.username,
    created_at: row.postedAt.toISOString(),
    type: row.type as MediaType,
    caption: row.caption,
    original_post_url: row.originalPostUrl,
    display_url: row.displayUrl,
    thumbnail_url: row.thumbnailUrl,
    video_stream_url: row.videoStreamUrl,
    preview_url: row.previewUrl,
    width: row.width,
    height: row.height,
    duration_ms: row.durationMs,
    download_variants: row.downloadVariants ?? [],
  };
}

export function profileToState(row: ProfileRow): ProfileState {
  return {
    user_id: row.userId ?? "",
    username: row.username,
    display_name: row.displayName ?? row.username,
    avatar_url: row.avatarUrl ?? "",
    bio: row.bio ?? "",
    created_at: row.accountCreatedAt?.toISOString() ?? null,
    media_count: row.mediaCount,
    followers_count: row.followersCount,
    is_protected: row.isProtected,
    total_cached: row.totalMedia,
    fully_scraped: row.fullyScraped,
    last_scraped_at: row.lastScrapedAt?.toISOString() ?? null,
  };
}

export async function getProfile(username: string): Promise<ProfileRow | null> {
  const [row] = await db.select().from(profiles).where(eq(profiles.username, username.toLowerCase())).limit(1);
  return row ?? null;
}

export async function ensureProfile(username: string): Promise<ProfileRow> {
  const existing = await getProfile(username);
  if (existing) return existing;
  const [row] = await db
    .insert(profiles)
    .values({ username: username.toLowerCase() })
    .onConflictDoNothing({ target: profiles.username })
    .returning();
  return row ?? (await getProfile(username))!;
}

export async function saveProfileInfo(id: number, info: ProfileInfo): Promise<ProfileRow> {
  const [row] = await db
    .update(profiles)
    .set({
      userId: info.user_id,
      displayName: info.display_name,
      avatarUrl: info.avatar_url,
      bio: info.bio,
      accountCreatedAt: info.created_at ? new Date(info.created_at) : null,
      mediaCount: info.media_count,
      followersCount: info.followers_count,
      isProtected: info.is_protected,
      updatedAt: new Date(),
    })
    .where(eq(profiles.id, id))
    .returning();
  return row;
}

export async function updateScrapeState(
  id: number,
  patch: Partial<Pick<ProfileRow, "fullyScraped" | "resumeCursor" | "newestTweetId" | "oldestTweetId" | "lastError">>,
) {
  await db
    .update(profiles)
    .set({ ...patch, lastScrapedAt: new Date(), updatedAt: new Date() })
    .where(eq(profiles.id, id));
}

export async function refreshTotals(id: number): Promise<number> {
  const [{ total }] = await db.select({ total: count() }).from(mediaItems).where(eq(mediaItems.profileId, id));
  await db.update(profiles).set({ totalMedia: total }).where(eq(profiles.id, id));
  return total;
}

export async function getKnownMediaIds(profileId: number): Promise<Set<string>> {
  const rows = await db.select({ id: mediaItems.id }).from(mediaItems).where(eq(mediaItems.profileId, profileId));
  return new Set(rows.map((r) => r.id));
}

export async function* iterateCachedMedia(profileId: number, batchSize = 400): AsyncGenerator<MediaItem[]> {
  let offset = 0;
  for (;;) {
    const rows = await db
      .select()
      .from(mediaItems)
      .where(eq(mediaItems.profileId, profileId))
      .orderBy(desc(mediaItems.postedAt), desc(mediaItems.id))
      .limit(batchSize)
      .offset(offset);
    if (!rows.length) return;
    yield rows.map(rowToMediaItem);
    if (rows.length < batchSize) return;
    offset += batchSize;
  }
}

export async function queryCachedMedia(opts: {
  profileId: number;
  type?: MediaType | "all";
  order?: "newest" | "oldest";
  offset?: number;
  limit?: number;
}): Promise<{ items: MediaItem[]; total: number }> {
  const where =
    opts.type && opts.type !== "all"
      ? and(eq(mediaItems.profileId, opts.profileId), eq(mediaItems.type, opts.type))
      : eq(mediaItems.profileId, opts.profileId);
  const orderBy = opts.order === "oldest" ? asc(mediaItems.postedAt) : desc(mediaItems.postedAt);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(mediaItems).where(where).orderBy(orderBy).limit(opts.limit ?? 200).offset(opts.offset ?? 0),
    db.select({ total: count() }).from(mediaItems).where(where),
  ]);
  return { items: rows.map(rowToMediaItem), total };
}

/** Bulk insert, ignoring rows already present. Returns the number of rows actually inserted. */
export async function insertMediaItems(profileId: number, items: MediaItem[]): Promise<number> {
  if (!items.length) return 0;
  let inserted = 0;
  const chunkSize = 200;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const res = await db
      .insert(mediaItems)
      .values(
        chunk.map((m) => ({
          id: m.id,
          profileId,
          tweetId: m.tweet_id,
          mediaKey: m.id.split("_").slice(1).join("_"),
          username: m.username,
          postedAt: new Date(m.created_at),
          type: m.type,
          caption: m.caption,
          originalPostUrl: m.original_post_url,
          displayUrl: m.display_url,
          thumbnailUrl: m.thumbnail_url,
          videoStreamUrl: m.video_stream_url,
          previewUrl: m.preview_url,
          width: m.width,
          height: m.height,
          durationMs: m.duration_ms,
          downloadVariants: m.download_variants,
        })),
      )
      .onConflictDoNothing({ target: mediaItems.id })
      .returning({ id: mediaItems.id });
    inserted += res.length;
  }
  if (inserted) {
    await db
      .update(profiles)
      .set({ totalMedia: sql`${profiles.totalMedia} + ${inserted}`, updatedAt: new Date() })
      .where(eq(profiles.id, profileId));
  }
  return inserted;
}

export async function listProfiles(limit = 24) {
  return db
    .select()
    .from(profiles)
    .where(isNotNull(profiles.userId))
    .orderBy(desc(profiles.lastScrapedAt), desc(profiles.updatedAt))
    .limit(limit);
}

export async function deleteProfile(username: string) {
  await db.delete(profiles).where(eq(profiles.username, username.toLowerCase()));
}
