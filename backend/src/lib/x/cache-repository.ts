import type { MediaItem, MediaType, ProfileInfo, ProfileState } from "./types.js";

export interface ProfileRecord {
  id: number;
  username: string;
  displayName: string | null;
  userId: string | null;
  avatarUrl: string | null;
  bio: string | null;
  accountCreatedAt: string | null;
  mediaCount: number;
  followersCount: number;
  isProtected: boolean;
  totalMedia: number;
  fullyScraped: boolean;
  resumeCursor: string | null;
  newestTweetId: string | null;
  oldestTweetId: string | null;
  lastScrapedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

let nextProfileId = 1;
const profilesByUsername = new Map<string, ProfileRecord>();
const profilesById = new Map<number, ProfileRecord>();
const mediaByProfileId = new Map<number, Map<string, MediaItem>>();

export function profileToState(row: ProfileRecord): ProfileState {
  return {
    user_id: row.userId ?? "",
    username: row.username,
    display_name: row.displayName ?? row.username,
    avatar_url: row.avatarUrl ?? "",
    bio: row.bio ?? "",
    created_at: row.accountCreatedAt ?? null,
    media_count: row.mediaCount,
    followers_count: row.followersCount,
    is_protected: row.isProtected,
    total_cached: row.totalMedia,
    fully_scraped: row.fullyScraped,
    last_scraped_at: row.lastScrapedAt ?? null,
  };
}

export async function getProfile(username: string): Promise<ProfileRecord | null> {
  return profilesByUsername.get(username.toLowerCase()) ?? null;
}

export async function ensureProfile(username: string): Promise<ProfileRecord> {
  const clean = username.toLowerCase();
  const existing = profilesByUsername.get(clean);
  if (existing) return existing;

  const id = nextProfileId++;
  const record: ProfileRecord = {
    id,
    username: clean,
    displayName: null,
    userId: null,
    avatarUrl: null,
    bio: null,
    accountCreatedAt: null,
    mediaCount: 0,
    followersCount: 0,
    isProtected: false,
    totalMedia: 0,
    fullyScraped: false,
    resumeCursor: null,
    newestTweetId: null,
    oldestTweetId: null,
    lastScrapedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  profilesByUsername.set(clean, record);
  profilesById.set(id, record);
  mediaByProfileId.set(id, new Map());
  return record;
}

export async function saveProfileInfo(id: number, info: ProfileInfo): Promise<ProfileRecord> {
  const profile = profilesById.get(id);
  if (!profile) throw new Error(`Profile with id ${id} not found`);

  profile.displayName = info.display_name;
  profile.userId = info.user_id;
  profile.avatarUrl = info.avatar_url;
  profile.bio = info.bio;
  profile.accountCreatedAt = info.created_at;
  profile.mediaCount = info.media_count;
  profile.followersCount = info.followers_count;
  profile.isProtected = info.is_protected;
  profile.updatedAt = new Date().toISOString();

  return profile;
}

export async function saveResumeCursor(
  id: number,
  cursor: string | null,
  newestTweetId?: string,
  oldestTweetId?: string,
): Promise<void> {
  const profile = profilesById.get(id);
  if (!profile) return;
  profile.resumeCursor = cursor;
  if (newestTweetId) profile.newestTweetId = newestTweetId;
  if (oldestTweetId) profile.oldestTweetId = oldestTweetId;
  profile.lastScrapedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
}

export async function markFullyScraped(id: number, fully = true): Promise<void> {
  const profile = profilesById.get(id);
  if (!profile) return;
  profile.fullyScraped = fully;
  if (fully) profile.resumeCursor = null;
  profile.lastScrapedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
}

export async function updateScrapeState(
  id: number,
  patch: Partial<Pick<ProfileRecord, "fullyScraped" | "resumeCursor" | "newestTweetId" | "oldestTweetId" | "lastError">>,
): Promise<void> {
  const profile = profilesById.get(id);
  if (!profile) return;
  Object.assign(profile, patch);
  profile.lastScrapedAt = new Date().toISOString();
  profile.updatedAt = new Date().toISOString();
}

export async function refreshTotals(id: number): Promise<number> {
  const profile = profilesById.get(id);
  if (!profile) return 0;
  const count = mediaByProfileId.get(id)?.size ?? 0;
  profile.totalMedia = count;
  return count;
}

export async function getKnownMediaIds(profileId: number): Promise<Set<string>> {
  const map = mediaByProfileId.get(profileId);
  return new Set(map ? map.keys() : []);
}

export async function* iterateCachedMedia(profileId: number, batchSize = 400): AsyncGenerator<MediaItem[]> {
  const map = mediaByProfileId.get(profileId);
  if (!map || map.size === 0) return;
  const list = Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  for (let i = 0; i < list.length; i += batchSize) {
    yield list.slice(i, i + batchSize);
  }
}

export async function queryCachedMedia(opts: {
  profileId: number;
  type?: MediaType | "all";
  order?: "newest" | "oldest";
  offset?: number;
  limit?: number;
}): Promise<{ items: MediaItem[]; total: number }> {
  const map = mediaByProfileId.get(opts.profileId);
  if (!map) return { items: [], total: 0 };
  let items = Array.from(map.values());
  if (opts.type && opts.type !== "all") {
    items = items.filter((i) => i.type === opts.type);
  }
  items.sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return opts.order === "oldest" ? timeA - timeB : timeB - timeA;
  });
  const total = items.length;
  const offset = opts.offset || 0;
  const limit = opts.limit || 200;
  return { items: items.slice(offset, offset + limit), total };
}

export async function insertMediaItems(profileId: number, items: MediaItem[]): Promise<number> {
  return saveMediaBatch(profileId, items);
}

export async function saveMediaBatch(profileId: number, items: MediaItem[]): Promise<number> {
  const profile = profilesById.get(profileId);
  if (!profile || items.length === 0) return 0;

  let profileMedia = mediaByProfileId.get(profileId);
  if (!profileMedia) {
    profileMedia = new Map();
    mediaByProfileId.set(profileId, profileMedia);
  }

  let inserted = 0;
  for (const item of items) {
    if (!profileMedia.has(item.id)) {
      profileMedia.set(item.id, item);
      inserted++;
    }
  }

  profile.totalMedia = profileMedia.size;
  profile.updatedAt = new Date().toISOString();
  return inserted;
}

export async function getCachedMedia(
  profileId: number,
  opts: {
    type?: MediaType;
    order?: "newest" | "oldest";
    offset?: number;
    limit?: number;
  } = {},
): Promise<MediaItem[]> {
  const profileMedia = mediaByProfileId.get(profileId);
  if (!profileMedia) return [];

  let items = Array.from(profileMedia.values());
  if (opts.type) {
    items = items.filter((i) => i.type === opts.type);
  }

  items.sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    return opts.order === "oldest" ? timeA - timeB : timeB - timeA;
  });

  const offset = opts.offset || 0;
  const limit = opts.limit || items.length;
  return items.slice(offset, offset + limit);
}

export async function listRecentProfiles(limit = 20): Promise<ProfileState[]> {
  const list = Array.from(profilesById.values())
    .filter((p) => p.totalMedia > 0 || p.lastScrapedAt)
    .sort((a, b) => {
      const timeA = a.lastScrapedAt ? new Date(a.lastScrapedAt).getTime() : 0;
      const timeB = b.lastScrapedAt ? new Date(b.lastScrapedAt).getTime() : 0;
      return timeB - timeA;
    })
    .slice(0, limit);

  return list.map(profileToState);
}

export async function deleteProfile(username: string): Promise<boolean> {
  const clean = username.toLowerCase();
  const profile = profilesByUsername.get(clean);
  if (!profile) return false;

  profilesByUsername.delete(clean);
  profilesById.delete(profile.id);
  mediaByProfileId.delete(profile.id);
  return true;
}
