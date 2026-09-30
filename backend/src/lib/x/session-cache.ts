import type { SessionCookie } from "./types.js";

export interface SessionEntry {
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

export interface UserSessionInput {
  id?: number;
  label?: string;
  auth_token?: string;
  authToken?: string;
  ct0?: string;
  user_agent?: string;
  userAgent?: string;
}

export function mask(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

/**
 * In-Memory Session Pool.
 * Holds active credentials strictly in volatile memory.
 * No data is ever written to disk (cookies.json) to ensure complete user privacy.
 */
export class SessionPool {
  private nextId = 1;
  private sessionMap = new Map<number, SessionEntry>();

  constructor(initialSessions: UserSessionInput[] = []) {
    for (const input of initialSessions) {
      this.add(input);
    }
  }

  public add(input: UserSessionInput): SessionEntry | null {
    const rawAuth = (input.auth_token || input.authToken || "").trim();
    const rawCt0 = (input.ct0 || "").trim();
    if (!rawAuth || !rawCt0) return null;

    const authToken = rawAuth.replace(/^auth_token=/i, "").replace(/;.*$/, "");
    const ct0 = rawCt0.replace(/^ct0=/i, "").replace(/;.*$/, "");

    // Check if session with same token already exists
    for (const s of this.sessionMap.values()) {
      if (s.authToken === authToken) {
        if (ct0 && s.ct0 !== ct0) s.ct0 = ct0;
        return s;
      }
    }

    const id = input.id && input.id > 0 ? input.id : this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;

    const entry: SessionEntry = {
      id,
      label: input.label?.trim() || `Session #${id}`,
      authToken,
      ct0,
      userAgent: input.user_agent || input.userAgent || null,
      status: "active",
      cooldownUntil: null,
      requestsCount: 0,
      lastUsedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };

    this.sessionMap.set(id, entry);
    return entry;
  }

  public acquire(excludeIds: number[] = []): { session: SessionCookie | null; waitSeconds: number; total: number } {
    const now = new Date();
    const excludeSet = new Set(excludeIds);

    // Check cooldown expirations
    for (const s of this.sessionMap.values()) {
      if (s.status === "cooldown" && s.cooldownUntil && new Date(s.cooldownUntil) <= now) {
        s.status = "active";
        s.cooldownUntil = null;
        s.lastError = null;
      }
    }

    const all = Array.from(this.sessionMap.values());
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

    // Shortest cooldown calculation
    const cooling = all.filter((s) => s.status === "cooldown" && s.cooldownUntil);
    let waitSeconds = 60;
    if (cooling.length > 0) {
      const nextCool = Math.min(...cooling.map((s) => new Date(s.cooldownUntil!).getTime()));
      waitSeconds = Math.max(1, Math.ceil((nextCool - now.getTime()) / 1000));
    }

    return { session: null, waitSeconds, total: all.length };
  }

  public markUsed(id: number, refreshedCt0?: string): void {
    const session = this.sessionMap.get(id);
    if (!session) return;
    session.requestsCount++;
    session.lastUsedAt = new Date().toISOString();
    if (refreshedCt0 && refreshedCt0 !== session.ct0) {
      session.ct0 = refreshedCt0;
    }
  }

  public markRateLimited(id: number, until: Date, reason = "HTTP 429"): void {
    const session = this.sessionMap.get(id);
    if (!session) return;
    session.status = "cooldown";
    session.cooldownUntil = until.toISOString();
    session.lastError = reason;
  }

  public markInvalid(id: number, reason: string): void {
    const session = this.sessionMap.get(id);
    if (!session) return;
    session.status = "invalid";
    session.lastError = reason;
  }

  public reset(id: number): boolean {
    const session = this.sessionMap.get(id);
    if (!session) return false;
    session.status = "active";
    session.cooldownUntil = null;
    session.lastError = null;
    return true;
  }

  public delete(id: number): boolean {
    return this.sessionMap.delete(id);
  }

  public count(): { active: number; total: number } {
    const all = Array.from(this.sessionMap.values());
    const active = all.filter((s) => s.status === "active").length;
    return { active, total: all.length };
  }

  public size(): number {
    return this.sessionMap.size;
  }

  public getOverview() {
    const list = Array.from(this.sessionMap.values()).map((s) => ({
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

    return {
      sessions: list,
      counts: {
        active: list.filter((s) => s.status === "active").length,
        cooldown: list.filter((s) => s.status === "cooldown").length,
        invalid: list.filter((s) => s.status === "invalid").length,
        total: list.length,
      },
    };
  }
}

/** Global server-level pool (loads optional environment variables only). */
export const serverSessionPool = new SessionPool();

export function loadEnvSessions(): void {
  if (process.env.X_COOKIES_JSON) {
    try {
      const parsed = JSON.parse(process.env.X_COOKIES_JSON);
      if (Array.isArray(parsed)) {
        for (const item of parsed) serverSessionPool.add(item);
      }
    } catch {
      console.warn("[session-cache] X_COOKIES_JSON is not valid JSON");
    }
  }
  if (process.env.X_AUTH_TOKEN && process.env.X_CT0) {
    serverSessionPool.add({
      label: "env",
      authToken: process.env.X_AUTH_TOKEN,
      ct0: process.env.X_CT0,
    });
  }
}

loadEnvSessions();

/** Creates a per-user, request-scoped ephemeral session pool that lives only in memory. */
export function createSessionPool(sessions: UserSessionInput[]): SessionPool {
  return new SessionPool(sessions);
}

// Delegating helpers for default pool
export async function syncExternalSessions(): Promise<number> {
  loadEnvSessions();
  return serverSessionPool.size();
}

export async function acquireSession(
  excludeIds: number[] = [],
  customPool?: SessionPool,
): Promise<{ session: SessionCookie | null; waitSeconds: number; total: number }> {
  const pool = customPool || serverSessionPool;
  return pool.acquire(excludeIds);
}

export async function markUsed(id: number, refreshedCt0?: string, customPool?: SessionPool): Promise<void> {
  const pool = customPool || serverSessionPool;
  pool.markUsed(id, refreshedCt0);
}

export async function markRateLimited(id: number, until: Date, reason = "HTTP 429", customPool?: SessionPool): Promise<void> {
  const pool = customPool || serverSessionPool;
  pool.markRateLimited(id, until, reason);
}

export async function markInvalid(id: number, reason: string, customPool?: SessionPool): Promise<void> {
  const pool = customPool || serverSessionPool;
  pool.markInvalid(id, reason);
}

export async function resetSession(id: number, customPool?: SessionPool): Promise<boolean> {
  const pool = customPool || serverSessionPool;
  return pool.reset(id);
}

export async function countUsableSessions(customPool?: SessionPool): Promise<{ active: number; total: number }> {
  const pool = customPool || serverSessionPool;
  return pool.count();
}

export async function deleteSession(id: number, customPool?: SessionPool): Promise<boolean> {
  const pool = customPool || serverSessionPool;
  return pool.delete(id);
}

export async function addSession(data: UserSessionInput, customPool?: SessionPool): Promise<SessionEntry | null> {
  const pool = customPool || serverSessionPool;
  return pool.add(data);
}

export async function getSessionOverview(customPool?: SessionPool) {
  const pool = customPool || serverSessionPool;
  return pool.getOverview();
}
