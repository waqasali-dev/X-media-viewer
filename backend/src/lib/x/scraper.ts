import {
  JITTER_MAX_MS,
  JITTER_MIN_MS,
  PAGE_SIZE,
  USER_FIELD_TOGGLES,
  normalizeHandle,
  randomBetween,
  sleep,
} from "./constants.js";
import { NoSessionError, RateLimitError, SessionInvalidError, XApiError, gqlRequest } from "./client.js";
import { parseUserMediaPage, parseUserResult, type ParsedPage } from "./parser.js";
import { playwrightUserMediaPages } from "./playwright-fallback.js";
import {
  ensureProfile,
  getKnownMediaIds,
  insertMediaItems,
  iterateCachedMedia,
  profileToState,
  refreshTotals,
  saveProfileInfo,
  updateScrapeState,
} from "./cache-repository.js";
import { acquireSession, countUsableSessions, markUsed } from "./session-cache.js";
import type { ProfileInfo, StreamEvent } from "./types.js";

export type ScraperMode = "auto" | "graphql" | "playwright";

export interface ScrapeOptions {
  signal?: AbortSignal;
  mode?: ScraperMode;
  full?: boolean;
}

interface PassResult {
  reachedEnd: boolean;
  stoppedEarly: boolean;
  interrupted: boolean;
}

const MAX_CONSECUTIVE_FAILURES = 6;

function maxId(a: string | null, b: string): string {
  if (!a) return b;
  return BigInt(a) >= BigInt(b) ? a : b;
}
function minId(a: string | null, b: string): string {
  if (!a) return b;
  return BigInt(a) <= BigInt(b) ? a : b;
}

export async function* scrapeProfileMedia(rawHandle: string, opts: ScrapeOptions = {}): AsyncGenerator<StreamEvent> {
  const signal = opts.signal;
  const normalized = normalizeHandle(rawHandle);
  if (!normalized) {
    yield { type: "error", code: "invalid_handle", message: "Enter a valid X handle or profile URL (e.g. @nasa or https://x.com/nasa)." };
    return;
  }
  const handle: string = normalized;
  const mode: ScraperMode = opts.mode ?? ((process.env.X_SCRAPER_MODE as ScraperMode) || "auto");

  /* ---------- Step 1: cache check ---------- */
  yield { type: "status", status: "checking_cache", message: `Looking up @${handle} in the local archive…` };
  let profile = await ensureProfile(handle);
  const knownIds = await getKnownMediaIds(profile.id);
  const hadCache = knownIds.size > 0;
  let total = knownIds.size;

  if (profile.userId) yield { type: "profile", profile: profileToState(profile) };
  if (hadCache) {
    yield { type: "status", status: "cache_hit", message: `Loaded ${knownIds.size.toLocaleString()} cached items – checking for new posts…` };
    for await (const batch of iterateCachedMedia(profile.id)) {
      if (signal?.aborted) return;
      yield { type: "media", items: batch, source: "cache" };
    }
  }

  /* ---------- Step 2: sessions ---------- */
  const sessions = await countUsableSessions();
  if (sessions.total === 0) {
    yield {
      type: "error",
      code: "no_sessions",
      message: hadCache
        ? "Showing the cached archive. Add an X session (auth_token + ct0) in Settings to fetch new posts."
        : "No X sessions configured. Open Settings and paste an auth_token + ct0 cookie pair to start scraping.",
    };
    return;
  }

  /* ---------- Step 3: resolve user id ---------- */
  yield { type: "status", status: "resolving", message: `Resolving @${handle} via internal GraphQL…` };
  let info: ProfileInfo | null = null;
  let failures = 0;
  while (!info && !signal?.aborted) {
    try {
      const { json } = await gqlRequest("UserByScreenName", { screen_name: handle, withSafetyModeUserFields: true }, {
        fieldToggles: USER_FIELD_TOGGLES,
        signal,
        referer: `https://x.com/${handle}`,
      });
      const lookup = parseUserResult(json);
      if (!lookup.ok) {
        yield { type: "error", code: lookup.reason, message: lookup.message };
        return;
      }
      info = lookup.profile;
    } catch (err) {
      const handled = yield* handleRequestError(err, ++failures, signal);
      if (!handled) {
        if (profile.userId && mode !== "graphql") break;
        yield { type: "error", code: err instanceof NoSessionError ? "no_sessions" : "resolve_failed", message: (err as Error).message };
        return;
      }
    }
  }
  if (signal?.aborted) return;
  if (info) profile = await saveProfileInfo(profile.id, info);
  yield { type: "profile", profile: profileToState(profile) };

  if (!profile.userId) {
    yield { type: "error", code: "resolve_failed", message: "Could not resolve the account id." };
    return;
  }

  /* ---------- Step 4: paginate ---------- */
  const userId = profile.userId;
  const state = {
    fullyScraped: profile.fullyScraped && !opts.full,
    resumeCursor: opts.full ? null : profile.resumeCursor,
    newestTweetId: profile.newestTweetId,
    oldestTweetId: profile.oldestTweetId,
    page: 0,
  };

  const processPage = async (parsed: ParsedPage, liveMode: "graphql" | "playwright"): Promise<StreamEvent[]> => {
    state.page++;
    const fresh = parsed.items.filter((m) => !knownIds.has(m.id));
    const events: StreamEvent[] = [];
    if (fresh.length) {
      const inserted = await insertMediaItems(profile.id, fresh);
      for (const m of fresh) knownIds.add(m.id);
      total += inserted;
      for (const m of fresh) {
        state.newestTweetId = maxId(state.newestTweetId, m.tweet_id);
        state.oldestTweetId = minId(state.oldestTweetId, m.tweet_id);
      }
      events.push({ type: "media", items: fresh, source: "live" });
    }
    events.push({ type: "progress", total, page: state.page, new_items: fresh.length, mode: liveMode });
    return events;
  };

  async function* graphqlPass(startCursor: string | null, stopWhenNoNew: boolean, trackResume: boolean): AsyncGenerator<StreamEvent, PassResult> {
    let cursor: string | null = startCursor;
    let consecutiveFailures = 0;
    let emptyPages = 0;
    for (;;) {
      if (signal?.aborted) return { reachedEnd: false, stoppedEarly: false, interrupted: true };
      const variables: Record<string, unknown> = {
        userId,
        count: PAGE_SIZE,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        withV2Timeline: true,
      };
      if (cursor) variables.cursor = cursor;

      let parsed: ParsedPage;
      try {
        const { json } = await gqlRequest("UserMedia", variables, { signal, referer: `https://x.com/${handle}/media` });
        parsed = parseUserMediaPage(json, handle);
        consecutiveFailures = 0;
      } catch (err) {
        if (signal?.aborted) return { reachedEnd: false, stoppedEarly: false, interrupted: true };
        const handled = yield* handleRequestError(err, ++consecutiveFailures, signal);
        if (!handled) throw err;
        continue;
      }

      const events = await processPage(parsed, "graphql");
      for (const e of events) yield e;
      const newCount = events.find((e) => e.type === "media")?.items.length ?? 0;

      if (trackResume || newCount > 0) {
        await updateScrapeState(profile.id, {
          newestTweetId: state.newestTweetId,
          oldestTweetId: state.oldestTweetId,
          ...(trackResume ? { resumeCursor: parsed.bottomCursor } : {}),
          lastError: null,
        });
      }

      await sleep(randomBetween(JITTER_MIN_MS, JITTER_MAX_MS), signal);

      if (parsed.isEmpty) emptyPages++;
      const noMoreData = !parsed.bottomCursor || (parsed.isEmpty && emptyPages >= 2) || (parsed.bottomCursor === cursor);
      if (noMoreData) return { reachedEnd: true, stoppedEarly: false, interrupted: false };
      if (stopWhenNoNew && newCount === 0 && parsed.items.length > 0) {
        return { reachedEnd: false, stoppedEarly: true, interrupted: false };
      }
      cursor = parsed.bottomCursor;
    }
  }

  async function* playwrightPass(stopWhenNoNew: boolean): AsyncGenerator<StreamEvent, PassResult> {
    const { session, waitSeconds, total: totalSessions } = await acquireSession();
    if (!session) throw new NoSessionError(waitSeconds, totalSessions);
    await markUsed(session.id);
    yield { type: "status", status: "scraping", mode: "playwright", message: "Headless Chromium is scrolling the media tab and intercepting UserMedia payloads…" };
    let staleStreak = 0;
    let sawCursor = true;
    for await (const page of playwrightUserMediaPages(handle, session, signal)) {
      const parsed = parseUserMediaPage(page.json, handle);
      const events = await processPage(parsed, "playwright");
      for (const e of events) yield e;
      const newCount = events.find((e) => e.type === "media")?.items.length ?? 0;
      sawCursor = Boolean(parsed.bottomCursor);
      staleStreak = newCount === 0 && parsed.items.length > 0 ? staleStreak + 1 : 0;
      if (stopWhenNoNew && staleStreak >= 2) return { reachedEnd: false, stoppedEarly: true, interrupted: false };
      if (!sawCursor) return { reachedEnd: true, stoppedEarly: false, interrupted: false };
    }
    if (signal?.aborted) return { reachedEnd: false, stoppedEarly: false, interrupted: true };
    return { reachedEnd: !sawCursor, stoppedEarly: false, interrupted: false };
  }

  const finish = async (result: PassResult, liveMode: "graphql" | "playwright"): Promise<StreamEvent> => {
    if (result.reachedEnd) {
      state.fullyScraped = true;
      await updateScrapeState(profile.id, { fullyScraped: true, resumeCursor: null, lastError: null });
    }
    const finalTotal = await refreshTotals(profile.id);
    const message = result.interrupted
      ? "Stream interrupted – progress saved, reopen the profile to resume."
      : state.fullyScraped
        ? `Archive complete via ${liveMode}: ${finalTotal.toLocaleString()} media items from the account's first post to now.`
        : `Caught up: ${finalTotal.toLocaleString()} items archived.`;
    return { type: "done", total: finalTotal, fully_scraped: state.fullyScraped, message };
  };

  try {
    if (mode === "playwright") {
      const result = yield* playwrightPass(hadCache && state.fullyScraped);
      yield await finish(result, "playwright");
      return;
    }

    yield { type: "status", status: "scraping", mode: "graphql", message: hadCache ? "Fetching posts newer than the cached archive…" : "Paginating the UserMedia timeline from newest to oldest…" };

    let liveMode: "graphql" | "playwright" = "graphql";
    let result: PassResult;
    try {
      const stopWhenNoNew = hadCache && !opts.full && (state.fullyScraped || Boolean(state.resumeCursor));
      const trackResume = !stopWhenNoNew;
      result = yield* graphqlPass(null, stopWhenNoNew, trackResume);

      if (!result.reachedEnd && !result.interrupted && !state.fullyScraped && state.resumeCursor && !opts.full) {
        yield { type: "status", status: "scraping", mode: "graphql", message: "Resuming interrupted crawl towards the account's first posts…" };
        result = yield* graphqlPass(state.resumeCursor, false, true);
      }
    } catch (err) {
      if (mode === "auto" && shouldFallbackToPlaywright(err)) {
        yield { type: "status", status: "scraping", mode: "playwright", message: `GraphQL worker blocked (${(err as Error).message}). Switching to Playwright stealth fallback…` };
        liveMode = "playwright";
        result = yield* playwrightPass(hadCache && state.fullyScraped);
      } else {
        throw err;
      }
    }
    yield await finish(result, liveMode);
  } catch (err) {
    if (signal?.aborted) return;
    const message = (err as Error).message || "Unexpected scraper failure";
    await updateScrapeState(profile.id, { lastError: message }).catch(() => undefined);
    yield { type: "error", code: err instanceof NoSessionError ? "no_sessions" : "scrape_failed", message };
  }
}

function shouldFallbackToPlaywright(err: unknown): boolean {
  if (err instanceof NoSessionError) return false;
  if (err instanceof XApiError) return err.status === 404 || err.status === 403 || err.status >= 500;
  return err instanceof Error && !(err instanceof RateLimitError);
}

async function* handleRequestError(err: unknown, failures: number, signal?: AbortSignal): AsyncGenerator<StreamEvent, boolean> {
  if (failures > MAX_CONSECUTIVE_FAILURES) return false;

  if (err instanceof RateLimitError) {
    const { session, waitSeconds } = await acquireSession();
    if (session) {
      yield { type: "status", status: "scraping", message: `Session #${err.sessionId} hit a 429 – rotated to "${session.label}".` };
      await sleep(randomBetween(800, 1600), signal);
      return true;
    }
    const wait = Math.max(5, waitSeconds || err.waitSeconds);
    yield { type: "status", status: "cooling_down", wait_seconds: wait, message: `Rate limited by X. Cooling down for ${wait}s before rotating sessions…` };
    await sleep(wait * 1000, signal);
    return !signal?.aborted;
  }

  if (err instanceof NoSessionError) {
    if (err.total === 0 || err.waitSeconds === 0) return false;
    yield { type: "status", status: "cooling_down", wait_seconds: err.waitSeconds, message: `All sessions cooling down – waiting ${err.waitSeconds}s…` };
    await sleep(err.waitSeconds * 1000, signal);
    return !signal?.aborted;
  }

  if (err instanceof SessionInvalidError) {
    yield { type: "status", status: "scraping", message: `${err.message}. Rotating to the next session…` };
    return true;
  }

  if (err instanceof XApiError) {
    if (err.status >= 500 || err.status === 0) {
      const backoff = Math.min(30, 2 ** failures);
      yield { type: "status", status: "scraping", message: `X returned ${err.status}; retrying in ${backoff}s…` };
      await sleep(backoff * 1000, signal);
      return !signal?.aborted;
    }
    return false;
  }

  if (err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(err.message)) {
    const backoff = Math.min(30, 2 ** failures);
    yield { type: "status", status: "scraping", message: `Network hiccup (${err.message}); retrying in ${backoff}s…` };
    await sleep(backoff * 1000, signal);
    return !signal?.aborted;
  }
  return false;
}
