import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionCookie } from "./types.js";

interface SessionEntry {
  id: number;
  label: string;
  authToken: string;
  ct0: string;
  userAgent: string | null;
  status: "active" | "cooldown" | "invalid";
  cooldownUntil: string | null;
  requestsCount: number;
  lastUsedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface CookieFileEntry {
  label?: string;
  username?: string;
  auth_token?: string;
  authToken?: string;
  ct0?: string;
  user_agent?: string;
}

let nextId = 1;
const sessionMap = new Map<number, SessionEntry>();
let lastSyncAt = 0;

function getStorageFilePath(): string {
  return process.env.X_COOKIES_FILE || path.join(process.cwd(), "cookies.json");
}

/** Parses cookies.json and env vars into session candidates. */
async function loadExternalSessions(): Promise<CookieFileEntry[]> {
  const out: CookieFileEntry[] = [];
  const file = getStorageFilePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    const list: CookieFileEntry[] = Array.isArray(parsed) ? parsed : parsed?.sessions ?? parsed?.accounts ?? [];
    for (const entry of list) if (entry && typeof entry === "object") out.push(entry);
  } catch {
    /* file is optional */
  }
  if (process.env.X_COOKIES_JSON) {
    try {
      const parsed = JSON.parse(process.env.X_COOKIES_JSON);
      if (Array.isArray(parsed)) out.push(...parsed);
    } catch {
      console.warn("[session-cache] X_COOKIES_JSON is not valid JSON");
    }
  }
  if (process.env.X_AUTH_TOKEN && process.env.X_CT0) {
    out.push({ label: "env", auth_token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 });
  }
  return out;
}

/** Saves all current sessions to disk so dynamic sessions persist. */
async function persistSessionsToFile(): Promise<void> {
  const file = getStorageFilePath();
  try {
    const data = Array.from(sessionMap.values()).map((s) => ({
      label: s.label,
      auth_token: s.authToken,
      ct0: s.ct0,
    }));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.warn("[session-cache] Failed to persist sessions to file:", (err as Error).message);
  }
}

/** Imports cookies.json / env sessions into in-memory cache (idempotent). */
export async function syncExternalSessions(force = false): Promise<number> {
  if (!force && Date.now() - lastSyncAt < 60_000) return 0;
  lastSyncAt = Date.now();
  const entries = await loadExternalSessions();
  let imported = 0;

  for (const [i, entry] of entries.entries()) {
    const authToken = (entry.auth_token || entry.authToken || "").trim();
    const ct0 = (entry.ct0 || "").trim();
    if (!authToken || !ct0) continue;

    // Check if session with same authToken already exists
    let existing: SessionEntry | undefined;
    for (const s of sessionMap.values()) {
      if (s.authToken === authToken) {
        existing = s;
        break;
      }
    }

    if (!existing) {
      const id = nextId++;
      sessionMap.set(id, {
        id,
        label: entry.label || entry.username || `Session #${i + 1}`,
        authToken,
        ct0,
        userAgent: entry.user_agent || null,
        status: "active",
        cooldownUntil: null,
        requestsCount: 0,
        lastUsedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
      });
      imported++;
    } else if (existing.ct0 !== ct0) {
      existing.ct0 = ct0;
    }
  }

  return imported;
}

export async function acquireSession(
  excludeIds: number[] = [],
): Promise<{ session: SessionCookie | null; waitSeconds: number; total: number }> {
  await syncExternalSessions(false);

  const now = new Date();
  const excludeSet = new Set(excludeIds);

  // Check cooldowns
  for (const s of sessionMap.values()) {
    if (s.status === "cooldown" && s.cooldownUntil && new Date(s.cooldownUntil) <= now) {
      s.status = "active";
      s.cooldownUntil = null;
      s.lastError = null;
    }
  }

  const all = Array.from(sessionMap.values());
  const activeCandidates = all
    .filter((s) => s.status === "active" && !excludeSet.has(s.id))
    .sort((a, b) => {
      const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return aTime - bTime;
    });

  if (activeCandidates.length > 0) {
    const chosen = activeCandidates[0];
    return {
      session: {
        id: chosen.id,
        label: chosen.label,
        authToken: chosen.authToken,
        ct0: chosen.ct0,
        userAgent: chosen.userAgent,
        status: chosen.status,
        cooldownUntil: chosen.cooldownUntil,
        requestsCount: chosen.requestsCount,
        lastUsedAt: chosen.lastUsedAt,
        lastError: chosen.lastError,
      },
      waitSeconds: 0,
      total: all.length,
    };
  }

  // Find shortest cooldown
  const cooling = all.filter((s) => s.status === "cooldown" && s.cooldownUntil);
  let waitSeconds = 60;
  if (cooling.length > 0) {
    const nextCool = Math.min(...cooling.map((s) => new Date(s.cooldownUntil!).getTime()));
    waitSeconds = Math.max(1, Math.ceil((nextCool - now.getTime()) / 1000));
  }

  return { session: null, waitSeconds, total: all.length };
}

export async function markUsed(id: number, refreshedCt0?: string): Promise<void> {
  const session = sessionMap.get(id);
  if (!session) return;
  session.requestsCount++;
  session.lastUsedAt = new Date().toISOString();
  if (refreshedCt0 && refreshedCt0 !== session.ct0) {
    session.ct0 = refreshedCt0;
    void persistSessionsToFile();
  }
}

export async function markRateLimited(id: number, until: Date, reason = "HTTP 429"): Promise<void> {
  const session = sessionMap.get(id);
  if (!session) return;
  session.status = "cooldown";
  session.cooldownUntil = until.toISOString();
  session.lastError = reason;
}

export async function markInvalid(id: number, reason: string): Promise<void> {
  const session = sessionMap.get(id);
  if (!session) return;
  session.status = "invalid";
  session.lastError = reason;
}

export async function resetSession(id: number): Promise<boolean> {
  const session = sessionMap.get(id);
  if (!session) return false;
  session.status = "active";
  session.cooldownUntil = null;
  session.lastError = null;
  return true;
}

export async function countUsableSessions(): Promise<{ active: number; total: number }> {
  await syncExternalSessions(false);
  const all = Array.from(sessionMap.values());
  const active = all.filter((s) => s.status === "active").length;
  return { active, total: all.length };
}

export async function deleteSession(id: number): Promise<boolean> {
  const existed = sessionMap.delete(id);
  if (existed) void persistSessionsToFile();
  return existed;
}

export async function addSession(data: {
  label?: string;
  authToken: string;
  ct0: string;
  userAgent?: string;
}): Promise<SessionEntry> {
  const id = nextId++;
  const session: SessionEntry = {
    id,
    label: data.label?.trim() || `Session #${id}`,
    authToken: data.authToken.trim(),
    ct0: data.ct0.trim(),
    userAgent: data.userAgent?.trim() || null,
    status: "active",
    cooldownUntil: null,
    requestsCount: 0,
    lastUsedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
  sessionMap.set(id, session);
  void persistSessionsToFile();
  return session;
}

export function mask(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export async function getSessionOverview() {
  await syncExternalSessions(false);
  const list = Array.from(sessionMap.values()).map((s) => ({
    id: s.id,
    label: s.label,
    status: s.status,
    cooldownUntil: s.cooldownUntil,
    requestsCount: s.requestsCount,
    lastUsedAt: s.lastUsedAt,
    lastError: s.lastError,
    authTokenMasked: mask(s.authToken),
    ct0Masked: mask(s.ct0),
  }));

  const counts = {
    active: list.filter((s) => s.status === "active").length,
    cooldown: list.filter((s) => s.status === "cooldown").length,
    invalid: list.filter((s) => s.status === "invalid").length,
    total: list.length,
  };

  return { sessions: list, counts };
}
