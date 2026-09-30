"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaItem, ProfileState, StreamEvent, StreamStatus } from "@/lib/x/types";
import { getApiUrl } from "@/lib/api-client";
import { getClientSessions } from "@/lib/session-store";

export interface StreamState {
  handle: string | null;
  status: StreamStatus | "idle";
  message: string;
  waitSeconds: number | null;
  mode: "graphql" | "playwright" | null;
  profile: ProfileState | null;
  items: MediaItem[];
  liveCount: number;
  cachedCount: number;
  page: number;
  error: { code?: string; message: string } | null;
  isStreaming: boolean;
  fullyScraped: boolean;
}

const initialState: StreamState = {
  handle: null,
  status: "idle",
  message: "",
  waitSeconds: null,
  mode: null,
  profile: null,
  items: [],
  liveCount: 0,
  cachedCount: 0,
  page: 0,
  error: null,
  isStreaming: false,
  fullyScraped: false,
};

function byNewest(a: MediaItem, b: MediaItem): number {
  if (a.created_at === b.created_at) return a.id < b.id ? 1 : -1;
  return a.created_at < b.created_at ? 1 : -1;
}

export interface StartOptions {
  mode?: "auto" | "graphql" | "playwright";
  full?: boolean;
}

export function useMediaStream() {
  const [state, setState] = useState<StreamState>(initialState);
  const sourceRef = useRef<EventSource | null>(null);
  const mapRef = useRef<Map<string, MediaItem>>(new Map());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const flushItems = useCallback(() => {
    flushTimer.current = null;
    const items = Array.from(mapRef.current.values()).sort(byNewest);
    setState((s) => ({ ...s, items }));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(flushItems, 80);
  }, [flushItems]);

  const clearCountdown = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    countdownTimer.current = null;
  };

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    clearCountdown();
    setState((s) =>
      s.isStreaming
        ? {
            ...s,
            isStreaming: false,
            waitSeconds: null,
            status: s.status === "done" ? "done" : s.status,
            message: s.status === "done" ? s.message : "Stream stopped.",
          }
        : s,
    );
  }, []);

  const handleEvent = useCallback(
    (event: StreamEvent) => {
      switch (event.type) {
        case "status":
          clearCountdown();
          if (event.status === "cooling_down" && event.wait_seconds) {
            let remaining = event.wait_seconds;
            countdownTimer.current = setInterval(() => {
              remaining -= 1;
              setState((s) => ({ ...s, waitSeconds: Math.max(0, remaining) }));
              if (remaining <= 0) clearCountdown();
            }, 1000);
          }
          setState((s) => ({
            ...s,
            status: event.status,
            message: event.message ?? s.message,
            waitSeconds: event.status === "cooling_down" ? (event.wait_seconds ?? null) : null,
            mode: event.mode ?? s.mode,
          }));
          break;
        case "profile":
          setState((s) => ({ ...s, profile: event.profile, fullyScraped: event.profile.fully_scraped }));
          break;
        case "media": {
          let added = 0;
          for (const item of event.items) {
            if (!mapRef.current.has(item.id)) added++;
            mapRef.current.set(item.id, item);
          }
          scheduleFlush();
          setState((s) => ({
            ...s,
            liveCount: event.source === "live" ? s.liveCount + added : s.liveCount,
            cachedCount: event.source === "cache" ? s.cachedCount + added : s.cachedCount,
          }));
          break;
        }
        case "progress":
          setState((s) => ({
            ...s,
            page: event.page,
            mode: event.mode,
            status: s.status === "cooling_down" ? "scraping" : s.status,
            waitSeconds: null,
          }));
          break;
        case "done":
          clearCountdown();
          sourceRef.current?.close();
          sourceRef.current = null;
          if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushItems();
          }
          setState((s) => ({
            ...s,
            status: "done",
            message: event.message ?? "Done",
            isStreaming: false,
            fullyScraped: event.fully_scraped,
            waitSeconds: null,
          }));
          break;
        case "error":
          clearCountdown();
          sourceRef.current?.close();
          sourceRef.current = null;
          if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushItems();
          }
          setState((s) => ({
            ...s,
            status: "error",
            error: { code: event.code, message: event.message },
            message: event.message,
            isStreaming: false,
            waitSeconds: null,
          }));
          break;
      }
    },
    [flushItems, scheduleFlush],
  );

  const start = useCallback(
    (handle: string, opts: StartOptions = {}) => {
      sourceRef.current?.close();
      clearCountdown();
      mapRef.current = new Map();
      setState({ ...initialState, handle, isStreaming: true, status: "checking_cache", message: "Connecting…" });

      const params = new URLSearchParams({ username: handle });
      if (opts.mode) params.set("mode", opts.mode);
      if (opts.full) params.set("full", "1");

      // Attach sessions from the user's private browser cache (never shared on server)
      const userSessions = getClientSessions();
      if (userSessions.length > 0) {
        const payload = userSessions.map((s) => ({
          label: s.label,
          auth_token: s.authToken,
          ct0: s.ct0,
          user_agent: s.userAgent,
        }));
        try {
          params.set("session", btoa(JSON.stringify(payload)));
        } catch {
          params.set("session", encodeURIComponent(JSON.stringify(payload)));
        }
      }

      const streamUrl = getApiUrl(`/api/stream?${params.toString()}`);
      const es = new EventSource(streamUrl);
      sourceRef.current = es;
      es.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data) as StreamEvent);
        } catch {
          /* ignore malformed frames */
        }
      };
      es.onerror = () => {
        // Never let EventSource auto-reconnect (it would restart the crawl).
        if (sourceRef.current === es) {
          es.close();
          sourceRef.current = null;
          clearCountdown();
          if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushItems();
          }
          setState((s) =>
            s.status === "done" || s.status === "error"
              ? s
              : {
                  ...s,
                  isStreaming: false,
                  status: "error",
                  error: {
                    code: "connection_lost",
                    message: "Connection to the stream was lost. Progress is saved – search again to resume.",
                  },
                  message: "Connection lost.",
                },
          );
        }
      };
    },
    [flushItems, handleEvent],
  );

  useEffect(() => () => {
    sourceRef.current?.close();
    if (flushTimer.current) clearTimeout(flushTimer.current);
    clearCountdown();
  }, []);

  return { state, start, stop };
}
