import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/db";
import { xSessions, type XSessionRow } from "@/db/schema";
import type { SessionCookie } from "./types";

interface CookieFileEntry {
  label?: string;
  username?: string;
  auth_token?: string;
  authToken?: string;
  ct0?: string;
  user_agent?: string;
}

let lastSyncAt = 0;

/** Parses `cookies.json` (array of {auth_token, ct0}) and env vars into session candidates. */
async function loadExternalSessions(): Promise<CookieFileEntry[]> {
  const out: CookieFileEntry[] = [];
  const file = process.env.X_COOKIES_FILE || path.join(/* turbopackIgnore: true */ process.cwd(), "cookies.json");
  try {
    const raw = await fs.readFile(/* turbopackIgnore: true */ file, "utf8");
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
      console.warn("[session-pool] X_COOKIES_JSON is not valid JSON");
    }
  }
  if (process.env.X_AUTH_TOKEN && process.env.X_CT0) {
    out.push({ label: "env", auth_token: process.env.X_AUTH_TOKEN, ct0: process.env.X_CT0 });
  }
  return out;
}

/** Imports cookies.json / env sessions into the DB (idempotent). Throttled to once a minute. */
export async function syncExternalSessions(force = false): Promise<number> {
  if (!force && Date.now() - lastSyncAt < 60_000) return 0;
  lastSyncAt = Date.now();
  const entries = await loadExternalSessions();
  let imported = 0;
  for (const [i, entry] of entries.entries()) {
    const authToken = (entry.auth_token || entry.authToken || "").trim();
    const ct0 = (entry.ct0 || "").trim();
    if (!authToken || !ct0) continue;
    const res = await db
      .insert(xSessions)
      .values({
        label: entry.label || entry.username || `cookies.json #${i + 1}`,
        authToken,
        ct0,
        userAgent: entry.user_agent || null,
      })
      .onConflictDoNothing({ target: xSessions.authToken })
      .returning({ id: xSessions.id });
    imported += res.length;
  }
  return imported;
}

export async function addSession(input: { label?: string; authToken: string; ct0: string; userAgent?: string }) {
  const [row] = await db
    .insert(xSessions)
    .values({
      label: input.label?.trim() || `session ${new Date().toISOString().slice(0, 10)}`,
      authToken: input.authToken.trim(),
      ct0: input.ct0.trim(),
      userAgent: input.userAgent || null,
    })
    .onConflictDoUpdate({
      target: xSessions.authToken,
      set: { ct0: input.ct0.trim(), status: "active", cooldownUntil: null, lastError: null },
    })
    .returning();
  return row;
}

export async function deleteSession(id: number) {
  await db.delete(xSessions).where(eq(xSessions.id, id));
}

export async function resetSession(id: number) {
  await db.update(xSessions).set({ status: "active", cooldownUntil: null, lastError: null }).where(eq(xSessions.id, id));
}

export async function listSessions(): Promise<
  (Omit<XSessionRow, "authToken" | "ct0"> & { authTokenMasked: string; ct0Masked: string })[]
> {
  await syncExternalSessions();
  const rows = await db.select().from(xSessions).orderBy(asc(xSessions.id));
  return rows.map(({ authToken, ct0, ...rest }) => ({
    ...rest,
    authTokenMasked: mask(authToken),
    ct0Masked: mask(ct0),
  }));
}

function mask(value: string) {
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export interface AcquireResult {
  session: SessionCookie | null;
  /** seconds until the soonest cooling-down session becomes available (0 if none exist at all) */
  waitSeconds: number;
  total: number;
}

/**
 * Picks the least-recently-used healthy session. Sessions whose cooldown
 * expired are automatically re-activated.
 */
export async function acquireSession(exclude: number[] = []): Promise<AcquireResult> {
  await syncExternalSessions();
  const now = new Date();
  await db
    .update(xSessions)
    .set({ status: "active", cooldownUntil: null })
    .where(and(eq(xSessions.status, "cooldown"), or(isNull(xSessions.cooldownUntil), lt(xSessions.cooldownUntil, now))));

  const rows = await db.select().from(xSessions).orderBy(asc(xSessions.lastUsedAt), asc(xSessions.id));
  const usable = rows.filter((r) => r.status === "active" && !exclude.includes(r.id));
  if (usable.length > 0) {
    const s = usable[0];
    return {
      session: { id: s.id, label: s.label, authToken: s.authToken, ct0: s.ct0, userAgent: s.userAgent },
      waitSeconds: 0,
      total: rows.length,
    };
  }
  const cooling = rows.filter((r) => r.status === "cooldown" && r.cooldownUntil);
  const soonest = cooling.reduce<number>((min, r) => {
    const secs = Math.ceil((r.cooldownUntil!.getTime() - now.getTime()) / 1000);
    return Math.min(min, Math.max(1, secs));
  }, Number.POSITIVE_INFINITY);
  return { session: null, waitSeconds: Number.isFinite(soonest) ? soonest : 0, total: rows.length };
}

export async function markUsed(id: number, newCt0?: string) {
  await db
    .update(xSessions)
    .set({
      lastUsedAt: new Date(),
      requestsCount: sql`${xSessions.requestsCount} + 1`,
      ...(newCt0 ? { ct0: newCt0 } : {}),
    })
    .where(eq(xSessions.id, id));
}

export async function markRateLimited(id: number, until: Date, reason: string) {
  await db
    .update(xSessions)
    .set({ status: "cooldown", cooldownUntil: until, lastError: reason, lastUsedAt: new Date() })
    .where(eq(xSessions.id, id));
}

export async function markInvalid(id: number, reason: string) {
  await db
    .update(xSessions)
    .set({ status: "invalid", lastError: reason, lastUsedAt: new Date() })
    .where(eq(xSessions.id, id));
}

export async function countUsableSessions(): Promise<{ active: number; cooldown: number; invalid: number; total: number }> {
  await syncExternalSessions();
  const rows = await db.select({ status: xSessions.status }).from(xSessions);
  return {
    active: rows.filter((r) => r.status === "active").length,
    cooldown: rows.filter((r) => r.status === "cooldown").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    total: rows.length,
  };
}
