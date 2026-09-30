"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CheckCircle2,
  Clock,
  Database,
  Film,
  Image as ImageIcon,
  KeyRound,
  LayoutGrid,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  AlertTriangle,
  X,
  Zap,
} from "lucide-react";
import { useMediaStream } from "@/hooks/useMediaStream";
import { formatDate, formatNumber, matchesFilter, type MediaFilter, type SortOrder } from "@/lib/media-utils";
import type { ProfileState } from "@/lib/x/types";
import { getApiUrl } from "@/lib/api-client";
import { MediaGrid } from "./MediaGrid";
import { Lightbox } from "./Lightbox";
import { SessionManager } from "./SessionManager";

import { getClientSessions } from "@/lib/session-store";

interface Counts {
  active: number;
  total: number;
}

const SAMPLE_HANDLES = ["nasa", "spacex", "nature", "natgeo"];

export function ArchiveApp() {
  const [mounted, setMounted] = useState(false);
  const { state, start, stop } = useMediaStream();
  const [input, setInput] = useState("");
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [order, setOrder] = useState<SortOrder>("newest");
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [recent, setRecent] = useState<ProfileState[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const refreshMeta = useCallback(async () => {
    // Read private session cache directly from user's browser
    const userSessions = getClientSessions();
    setCounts({ active: userSessions.length, total: userSessions.length });

    try {
      const p = await fetch(getApiUrl("/api/profiles")).then((r) => r.json());
      if (p.profiles) setRecent(p.profiles);
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
    const handleUpdate = () => refreshMeta();
    window.addEventListener("x_sessions_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("x_sessions_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [refreshMeta]);

  useEffect(() => {
    if (state.status === "done" || state.status === "error") void refreshMeta();
  }, [state.status, refreshMeta]);

  // Deep-link support: /?u=handle
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("u");
    if (u) {
      setInput(u);
      start(u);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = (handle: string, full = false) => {
    const value = handle.trim();
    if (!value) return;
    setInput(value);
    setLightbox(null);
    setFilter("all");
    start(value, { full });
    const url = new URL(window.location.href);
    url.searchParams.set("u", value);
    window.history.replaceState(null, "", url.toString());
  };

  const visible = useMemo(() => {
    const filtered = filter === "all" ? state.items : state.items.filter((i) => matchesFilter(i, filter));
    return order === "newest" ? filtered : [...filtered].reverse();
  }, [state.items, filter, order]);

  const stats = useMemo(() => {
    let photos = 0;
    let videos = 0;
    let gifs = 0;
    for (const i of state.items) {
      if (i.type === "photo") photos++;
      else if (i.type === "video") videos++;
      else gifs++;
    }
    return { photos, videos, gifs };
  }, [state.items]);

  const noSessions = counts !== null && counts.total === 0;
  const busy = state.isStreaming;

  if (!mounted) {
    return null;
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 selection:bg-sky-500 selection:text-white" suppressHydrationWarning>
      {/* ---------------- Header ---------------- */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-neutral-950/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Logo */}
          <div
            className="flex cursor-pointer items-center gap-2.5 transition hover:opacity-90"
            onClick={() => {
              setInput("");
              window.history.replaceState(null, "", window.location.pathname);
            }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 text-white shadow-lg shadow-sky-500/25 ring-1 ring-white/20">
              <Archive size={20} />
            </span>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-white">
                <span>X Media Archive</span>
                <span className="rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[9px] font-bold text-sky-400">PRO</span>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-neutral-400">
                Infinite Stream Gallery
              </div>
            </div>
          </div>

          {/* Search Form */}
          <form
            className="order-last flex w-full flex-1 items-center gap-2 sm:order-none sm:w-auto sm:max-w-xl"
            onSubmit={(e) => {
              e.preventDefault();
              run(input);
            }}
          >
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter @handle or https://x.com/handle/media"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/5 pl-9 pr-8 text-sm text-white placeholder:text-neutral-500 transition-all focus:border-sky-400 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                spellCheck={false}
                autoCapitalize="none"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => setInput("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {busy ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-10 items-center gap-2 rounded-xl bg-rose-500/90 px-4 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 transition hover:bg-rose-500 active:scale-95"
              >
                <Square size={13} fill="currentColor" /> Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Radio size={15} /> Stream
              </button>
            )}
          </form>

          {/* Session Manager Pill */}
          <button
            type="button"
            onClick={() => setShowSessions(true)}
            className={`flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition ${
              noSessions
                ? "border-amber-400/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 shadow-lg shadow-amber-500/10"
                : "border-white/10 bg-white/5 text-neutral-300 hover:bg-white/10"
            }`}
            title="Your private session cache (stored in browser only)"
          >
            {noSessions ? (
              <>
                <KeyRound size={16} className="text-amber-400 animate-pulse" />
                <span className="hidden sm:inline">Add Session</span>
              </>
            ) : (
              <>
                <Settings size={16} />
                <span className="hidden sm:inline">
                  Sessions ({counts?.active ?? 0})
                </span>
                <span className={`h-2 w-2 rounded-full ${counts?.active ? "bg-emerald-400" : "bg-neutral-500"}`} />
              </>
            )}
          </button>
        </div>

        {/* ---------------- Live Status Bar ---------------- */}
        {state.handle && (
          <div className="border-t border-white/5 bg-neutral-900/60 backdrop-blur-md">
            <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-xs sm:px-6">
              <div className="flex flex-wrap items-center gap-3">
                <StatusPill state={state} />
                <span className="flex items-center gap-1.5 font-medium text-neutral-200">
                  <Database size={13} className="text-sky-400" />
                  {busy ? "Streaming" : "Archived"}{" "}
                  <strong className="text-white">{formatNumber(state.items.length)}</strong> items
                  {state.liveCount > 0 && (
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/20">
                      +{formatNumber(state.liveCount)} new
                    </span>
                  )}
                  {state.page > 0 && <span className="text-neutral-500">· page {state.page}</span>}
                </span>

                {state.mode && (
                  <span className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase font-bold text-neutral-400">
                    {state.mode === "graphql" ? "GraphQL Direct" : "Playwright Engine"}
                  </span>
                )}

                <span className="hidden text-neutral-400 md:inline truncate max-w-sm" title={state.message}>
                  {state.message}
                </span>
              </div>

              {/* Filters & Order */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-0.5">
                  <FilterButton
                    active={filter === "all"}
                    onClick={() => setFilter("all")}
                    icon={<LayoutGrid size={13} />}
                    label={`All (${formatNumber(state.items.length)})`}
                  />
                  <FilterButton
                    active={filter === "photo"}
                    onClick={() => setFilter("photo")}
                    icon={<ImageIcon size={13} />}
                    label={`Photos (${formatNumber(stats.photos)})`}
                  />
                  <FilterButton
                    active={filter === "video"}
                    onClick={() => setFilter("video")}
                    icon={<Film size={13} />}
                    label={`Videos (${formatNumber(stats.videos + stats.gifs)})`}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setOrder((o) => (o === "newest" ? "oldest" : "newest"))}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-neutral-300 transition hover:bg-white/10"
                  title="Toggle chronological order"
                >
                  {order === "newest" ? <ArrowDownWideNarrow size={14} /> : <ArrowUpNarrowWide size={14} />}
                  <span className="hidden sm:inline">{order === "newest" ? "Newest" : "Oldest"}</span>
                </button>

                {!busy && state.handle && (
                  <button
                    type="button"
                    onClick={() => run(state.handle!, true)}
                    className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-neutral-300 transition hover:bg-white/10 hover:text-sky-300"
                    title="Re-walk the whole timeline"
                  >
                    <RefreshCw size={13} />
                    <span className="hidden sm:inline">Rescan</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6">
        {/* Error Banners */}
        {state.error && (
          <div
            className={`mb-6 flex flex-wrap items-center gap-3 rounded-2xl border p-4 shadow-xl text-sm ${
              state.error.code === "no_sessions"
                ? "border-amber-400/40 bg-amber-500/10 text-amber-100 shadow-amber-500/5"
                : "border-rose-400/40 bg-rose-500/10 text-rose-100 shadow-rose-500/5"
            }`}
          >
            <AlertTriangle size={18} className="shrink-0 text-amber-400" />
            <span className="flex-1 font-medium">{state.error.message}</span>
            {state.error.code === "no_sessions" && (
              <button
                type="button"
                onClick={() => setShowSessions(true)}
                className="rounded-xl bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-black transition hover:bg-amber-300 shadow-md"
              >
                Configure Sessions
              </button>
            )}
            {state.error.code !== "no_sessions" && state.handle && (
              <button
                type="button"
                onClick={() => run(state.handle!)}
                className="rounded-xl border border-white/15 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {/* Profile Card */}
        {state.profile && (
          <ProfileCard
            profile={state.profile}
            archived={state.items.length}
            fullyScraped={state.fullyScraped}
          />
        )}

        {/* Landing Page */}
        {!state.handle && (
          <Landing
            recent={recent}
            onPick={run}
            noSessions={noSessions}
            onOpenSessions={() => setShowSessions(true)}
          />
        )}

        {/* Gallery Grid */}
        {state.handle && visible.length > 0 && (
          <MediaGrid items={visible} onOpen={(i) => setLightbox(i)} />
        )}

        {/* Empty State */}
        {state.handle && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 py-28 text-center text-neutral-400">
            {busy ? (
              <>
                <Loader2 size={36} className="mb-4 animate-spin text-sky-400" />
                <h3 className="text-base font-semibold text-white">Ingesting Media Stream</h3>
                <p className="mt-1 text-sm text-neutral-500">{state.message || "Connecting to X CDN worker…"}</p>
              </>
            ) : (
              <>
                <ImageIcon size={36} className="mb-4 text-neutral-600" />
                <h3 className="text-base font-semibold text-white">No items found</h3>
                <p className="mt-1 text-sm text-neutral-500">
                  {state.items.length ? "No media matches the selected filter." : "This account has not posted any media yet."}
                </p>
              </>
            )}
          </div>
        )}
      </main>

      {/* Lightbox Modal */}
      {lightbox !== null && visible[lightbox] && (
        <Lightbox
          items={visible}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onNavigate={setLightbox}
        />
      )}

      {/* Session Manager Modal */}
      {showSessions && (
        <SessionManager
          onClose={() => setShowSessions(false)}
          onChanged={setCounts}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StatusPill({ state }: { state: ReturnType<typeof useMediaStream>["state"] }) {
  const s = state.status;
  if (s === "cooling_down")
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/15 px-3 py-1 font-semibold text-amber-300">
        <Clock size={12} /> Cooling down {state.waitSeconds != null ? `${state.waitSeconds}s` : ""}
      </span>
    );
  if (s === "done")
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/15 px-3 py-1 font-semibold text-emerald-300">
        <CheckCircle2 size={12} /> {state.fullyScraped ? "Archive Complete" : "Up to date"}
      </span>
    );
  if (s === "error")
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-rose-500/20 bg-rose-500/15 px-3 py-1 font-semibold text-rose-300">
        <AlertTriangle size={12} /> Halted
      </span>
    );
  if (!state.isStreaming)
    return (
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-medium text-neutral-400">
        Ready
      </span>
    );
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/15 px-3 py-1 font-semibold text-sky-300 shadow-sm shadow-sky-500/10">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-400" />
      </span>
      {s === "cache_hit"
        ? "Fast Cache Load"
        : s === "resolving"
        ? "Resolving Account"
        : s === "checking_cache"
        ? "Inspecting Cache"
        : "Streaming Live"}
    </span>
  );
}

function FilterButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
        active
          ? "bg-sky-500 text-white shadow-md shadow-sky-500/20"
          : "text-neutral-400 hover:bg-white/10 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ProfileCard({
  profile,
  archived,
  fullyScraped,
}: {
  profile: ProfileState;
  archived: number;
  fullyScraped: boolean;
}) {
  return (
    <section className="mb-6 rounded-3xl border border-white/10 bg-gradient-to-r from-neutral-900/90 via-neutral-900/50 to-neutral-900/30 p-5 shadow-2xl backdrop-blur-xl">
      <div className="flex flex-wrap items-center gap-5">
        {profile.avatar_url ? (
          <img
            src={profile.avatar_url}
            alt=""
            className="h-16 w-16 rounded-2xl object-cover ring-2 ring-sky-500/50 shadow-xl"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-16 w-16 rounded-2xl bg-white/10 flex items-center justify-center text-xl font-bold">
            {profile.username[0]?.toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-extrabold text-white">
              {profile.display_name || profile.username}
            </h1>
            <a
              href={`https://x.com/${profile.username}`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-medium text-sky-400 transition hover:underline"
            >
              @{profile.username}
            </a>
            {profile.is_protected && (
              <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300 border border-amber-500/20">
                protected
              </span>
            )}
            {fullyScraped && (
              <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300 border border-emerald-500/20">
                <CheckCircle2 size={11} /> complete archive
              </span>
            )}
          </div>
          {profile.bio && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-300 max-w-3xl">
              {profile.bio}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-neutral-400">
            <span>
              <strong className="text-white">{formatNumber(archived)}</strong> media captured
            </span>
            {profile.media_count > 0 && (
              <span>
                <strong className="text-neutral-200">{formatNumber(profile.media_count)}</strong> total posted
              </span>
            )}
            {profile.followers_count > 0 && (
              <span>
                <strong className="text-neutral-200">{formatNumber(profile.followers_count)}</strong> followers
              </span>
            )}
            {profile.created_at && (
              <span>Joined {formatDate(profile.created_at, { year: "numeric", month: "short" })}</span>
            )}
            {profile.last_scraped_at && (
              <span>
                Synced {formatDate(profile.last_scraped_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Landing({
  recent,
  onPick,
  noSessions,
  onOpenSessions,
}: {
  recent: ProfileState[];
  onPick: (h: string) => void;
  noSessions: boolean;
  onOpenSessions: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl py-12 text-center animate-fade-in">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 shadow-2xl shadow-sky-500/30 ring-1 ring-white/20">
        <Archive size={38} className="text-white" />
      </div>

      <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
        Discover &amp; Stream Every X Media Asset
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-neutral-400">
        Replays X&apos;s internal <code className="rounded bg-white/10 px-1.5 py-0.5 text-sky-300">UserMedia</code> timeline without official API limits. Streams every high-res photo, video, and GIF directly from CDN into an infinite masonry gallery.
      </p>

      {/* Demo Handle Pills */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mr-1">
          Try handles:
        </span>
        {SAMPLE_HANDLES.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onPick(h)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-neutral-300 transition hover:border-sky-400 hover:bg-sky-500/10 hover:text-sky-300"
          >
            @{h}
          </button>
        ))}
      </div>

      {noSessions && (
        <div className="mx-auto mt-8 flex max-w-xl items-center gap-3.5 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-4 text-left text-sm text-amber-100 shadow-xl backdrop-blur-md">
          <KeyRound size={22} className="shrink-0 text-amber-300 animate-pulse" />
          <div className="flex-1">
            <div className="font-bold text-amber-200">No active session found</div>
            <div className="text-xs text-amber-300/80">Add your burner auth_token and ct0 cookies to stream live timelines.</div>
          </div>
          <button
            type="button"
            onClick={onOpenSessions}
            className="rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-black transition hover:bg-amber-300 shadow-md"
          >
            Set Up Session
          </button>
        </div>
      )}

      {/* Feature cards */}
      <div className="mt-12 grid gap-4 text-left sm:grid-cols-3">
        <Feature
          icon={<ShieldCheck size={20} className="text-emerald-400" />}
          title="Session Pool & Anti-Block"
          text="Rotates multiple accounts round-robin with automatic 429 jitter backoff and query recovery."
        />
        <Feature
          icon={<Zap size={20} className="text-amber-400" />}
          title="Instant In-Memory Cache"
          text="Returning to an archived profile streams instantly from memory cache, then fetches newest posts."
        />
        <Feature
          icon={<Sparkles size={20} className="text-sky-400" />}
          title="CORS Proxy & Video Playback"
          text="Streams direct HLS and MP4 with range requests, quality selection, and zero disk overhead."
        />
      </div>

      {/* Recently archived profiles */}
      {recent.length > 0 && (
        <div className="mt-14 border-t border-white/10 pt-8">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-neutral-400">
            Recently Archived Profiles
          </h2>
          <div className="flex flex-wrap justify-center gap-2.5">
            {recent.map((p) => (
              <button
                key={p.username}
                type="button"
                onClick={() => onPick(p.username)}
                className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/5 py-2 pl-2 pr-4 text-sm font-medium text-neutral-200 shadow-sm transition hover:border-sky-400/50 hover:bg-white/10 hover:shadow-sky-500/10"
              >
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="h-7 w-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-bold">
                    {p.username[0]?.toUpperCase()}
                  </span>
                )}
                <span>@{p.username}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-neutral-400">
                  {formatNumber(p.total_cached)}
                </span>
                {p.fully_scraped && <CheckCircle2 size={13} className="text-emerald-400" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Feature({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-5 shadow-lg backdrop-blur-md">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 shadow-inner">
        {icon}
      </div>
      <h3 className="text-sm font-bold text-white">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-neutral-400">{text}</p>
    </div>
  );
}
