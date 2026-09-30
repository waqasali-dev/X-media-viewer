import {
  BROWSER_PROFILES,
  DEFAULT_OPERATION_IDS,
  GQL_FEATURES,
  GQL_URL,
  PUBLIC_BEARER_TOKEN,
  RATE_LIMIT_COOLDOWN_SECONDS,
  type OperationName,
} from "./constants";
import { acquireSession, markInvalid, markRateLimited, markUsed } from "./session-pool";
import type { SessionCookie } from "./types";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class RateLimitError extends Error {
  constructor(
    public readonly sessionId: number,
    public readonly waitSeconds: number,
  ) {
    super(`Rate limited (session #${sessionId}), retry in ${waitSeconds}s`);
    this.name = "RateLimitError";
  }
}

export class SessionInvalidError extends Error {
  constructor(
    public readonly sessionId: number,
    message: string,
  ) {
    super(message);
    this.name = "SessionInvalidError";
  }
}

export class NoSessionError extends Error {
  constructor(
    public readonly waitSeconds: number,
    public readonly total: number,
  ) {
    super(
      total === 0
        ? "No X sessions configured. Add an auth_token + ct0 cookie pair in Settings (or cookies.json)."
        : `All ${total} sessions are cooling down or invalid.`,
    );
    this.name = "NoSessionError";
  }
}

export class XApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: number,
  ) {
    super(message);
    this.name = "XApiError";
  }
}

/* ------------------------------------------------------------------ */
/* x-client-transaction-id (signed per request, like the web client)   */
/* ------------------------------------------------------------------ */

type TxGenerator = { generateTransactionId(method: string, path: string): Promise<string> };
let txPromise: Promise<TxGenerator> | null = null;
let txCreatedAt = 0;
const TX_TTL_MS = 30 * 60 * 1000;

function randomTransactionId(): string {
  const bytes = new Uint8Array(70);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64").replace(/=+$/, "");
}

async function getTransactionId(method: string, path: string): Promise<string> {
  try {
    if (!txPromise || Date.now() - txCreatedAt > TX_TTL_MS) {
      txCreatedAt = Date.now();
      txPromise = (async () => {
        const mod = await import("x-client-transaction-id");
        const doc = await mod.fetchXDocument();
        return mod.ClientTransaction.create(doc);
      })();
    }
    const tx = await txPromise;
    return await tx.generateTransactionId(method, path);
  } catch (err) {
    console.warn("[x-client] transaction id generator unavailable, using random id:", (err as Error).message);
    txPromise = null;
    return randomTransactionId();
  }
}

/* ------------------------------------------------------------------ */
/* Operation-ID discovery (query hashes rotate with web deployments)   */
/* ------------------------------------------------------------------ */

const operationIds: Record<OperationName, string> = { ...DEFAULT_OPERATION_IDS };
let opsRefreshedAt = 0;

export function getOperationId(op: OperationName): string {
  return operationIds[op];
}

/** Scrapes x.com's main bundle for fresh `queryId` values. Returns true if anything changed. */
export async function refreshOperationIds(force = false): Promise<boolean> {
  if (!force && Date.now() - opsRefreshedAt < 10 * 60 * 1000) return false;
  opsRefreshedAt = Date.now();
  const profile = BROWSER_PROFILES[0];
  const headers = { "user-agent": profile.ua, accept: "text/html,*/*" };
  try {
    const html = await (await fetch("https://x.com/i/jf/", { headers })).text();
    const bundleUrls = new Set<string>();
    for (const m of html.matchAll(/https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.[\w.-]+\.js/g)) {
      bundleUrls.add(m[0]);
    }
    let changed = false;
    for (const url of bundleUrls) {
      const js = await (await fetch(url, { headers })).text();
      for (const m of js.matchAll(/queryId:"([\w-]+)",operationName:"(UserByScreenName|UserByRestId|UserMedia)"/g)) {
        const [, id, name] = m;
        const op = name as OperationName;
        if (operationIds[op] !== id) {
          console.info(`[x-client] operation ${op}: ${operationIds[op]} -> ${id}`);
          operationIds[op] = id;
          changed = true;
        }
      }
    }
    return changed;
  } catch (err) {
    console.warn("[x-client] failed to refresh operation ids:", (err as Error).message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Request pipeline                                                    */
/* ------------------------------------------------------------------ */

const learnedFeatures: Record<string, boolean> = {};

interface GqlOptions {
  fieldToggles?: Record<string, unknown>;
  signal?: AbortSignal;
  excludeSessions?: number[];
  referer?: string;
}

export interface GqlResult<T = unknown> {
  json: T;
  session: SessionCookie;
  rateLimitRemaining: number | null;
}

async function buildHeaders(session: SessionCookie, path: string, referer: string): Promise<Record<string, string>> {
  const fp = session.userAgent
    ? { ua: session.userAgent, secChUa: BROWSER_PROFILES[0].secChUa, platform: BROWSER_PROFILES[0].platform }
    : BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
  return {
    authorization: `Bearer ${PUBLIC_BEARER_TOKEN}`,
    cookie: `auth_token=${session.authToken}; ct0=${session.ct0}; lang=en`,
    "x-csrf-token": session.ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    "x-client-transaction-id": await getTransactionId("GET", path),
    "content-type": "application/json",
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    referer,
    origin: "https://x.com",
    "user-agent": fp.ua,
    "sec-ch-ua": fp.secChUa,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": fp.platform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };
}

function extractCt0(res: Response): string | null {
  const setCookies: string[] =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  for (const c of setCookies) {
    const m = c.match(/^ct0=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

function collectErrorMessages(json: unknown): { message: string; code?: number }[] {
  const errors = (json as { errors?: { message?: string; code?: number }[] })?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => ({ message: e.message || "unknown error", code: e.code }));
}

/**
 * Executes one GraphQL GET against x.com's internal API using a pooled session.
 * Throws RateLimitError / SessionInvalidError / NoSessionError / XApiError.
 */
export async function gqlRequest<T = unknown>(
  op: OperationName,
  variables: Record<string, unknown>,
  opts: GqlOptions = {},
): Promise<GqlResult<T>> {
  const { session, waitSeconds, total } = await acquireSession(opts.excludeSessions);
  if (!session) throw new NoSessionError(waitSeconds, total);

  let features: Record<string, boolean> = { ...GQL_FEATURES, ...learnedFeatures };
  let refreshedOps = false;
  let healedFeatures = false;
  let retriedCsrf = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const queryId = getOperationId(op);
    const path = `/i/api/graphql/${queryId}/${op}`;
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
      features: JSON.stringify(features),
    });
    if (opts.fieldToggles) params.set("fieldToggles", JSON.stringify(opts.fieldToggles));
    const url = `${GQL_URL}/${queryId}/${op}?${params.toString()}`;
    const headers = await buildHeaders(session, path, opts.referer || "https://x.com/");

    const res = await fetch(url, { headers, signal: opts.signal, redirect: "manual" });
    const freshCt0 = extractCt0(res);
    if (freshCt0 && freshCt0 !== session.ct0) session.ct0 = freshCt0;

    const remainingHeader = res.headers.get("x-rate-limit-remaining");
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const remaining = remainingHeader != null ? Number(remainingHeader) : null;
    const resetAt = resetHeader ? new Date(Number(resetHeader) * 1000) : null;

    if (res.status === 429) {
      const until =
        resetAt && resetAt.getTime() > Date.now()
          ? resetAt
          : new Date(Date.now() + RATE_LIMIT_COOLDOWN_SECONDS * 1000);
      const wait = Math.max(RATE_LIMIT_COOLDOWN_SECONDS, Math.ceil((until.getTime() - Date.now()) / 1000));
      await markRateLimited(session.id, until, `HTTP 429 on ${op}`);
      throw new RateLimitError(session.id, wait);
    }

    const bodyText = await res.text();
    let json: unknown = null;
    try {
      json = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      json = null;
    }
    const errors = collectErrorMessages(json);

    if (res.status === 401 || res.status === 403) {
      const csrfMismatch = errors.some((e) => e.code === 353) || /csrf/i.test(bodyText);
      if (csrfMismatch && freshCt0 && !retriedCsrf) {
        retriedCsrf = true;
        await markUsed(session.id, freshCt0);
        continue;
      }
      const reason = errors[0]?.message || `HTTP ${res.status} on ${op}`;
      await markInvalid(session.id, reason);
      throw new SessionInvalidError(session.id, `Session "${session.label}" rejected by X: ${reason}`);
    }

    if (res.status === 404 && !refreshedOps) {
      refreshedOps = true;
      const changed = await refreshOperationIds(true);
      if (changed) continue;
      throw new XApiError(404, `GraphQL operation ${op} returned 404 – the query id may be stale. Set X_OP_${op.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()} to a fresh value.`);
    }

    if (res.status === 400 && !healedFeatures) {
      const missing = errors
        .map((e) => e.message.match(/features cannot be null:\s*(.+)$/i)?.[1])
        .filter(Boolean)
        .flatMap((s) => s!.split(/[,\s]+/).filter(Boolean));
      if (missing.length) {
        healedFeatures = true;
        for (const f of missing) {
          learnedFeatures[f] = true;
        }
        features = { ...features, ...learnedFeatures };
        continue;
      }
    }

    if (!res.ok) {
      throw new XApiError(res.status, errors[0]?.message || `HTTP ${res.status} from X on ${op}`, errors[0]?.code);
    }

    // Account-level failures reported inside a 200 body.
    const fatal = errors.find((e) => [32, 64, 326, 353].includes(e.code ?? -1));
    if (fatal && !(json as { data?: unknown })?.data) {
      await markInvalid(session.id, fatal.message);
      throw new SessionInvalidError(session.id, `Session "${session.label}" rejected by X: ${fatal.message}`);
    }

    if (remaining === 0 && resetAt) {
      await markRateLimited(session.id, resetAt, `Quota exhausted on ${op}`);
    } else {
      await markUsed(session.id, freshCt0 && freshCt0 !== session.ct0 ? freshCt0 : undefined);
    }
    return { json: json as T, session, rateLimitRemaining: remaining };
  }
  throw new XApiError(500, `Gave up on ${op} after repeated retries`);
}
