export interface ClientSession {
  id: string;
  label: string;
  authToken: string;
  ct0: string;
  userAgent?: string;
  createdAt: string;
}

const STORAGE_KEY = "x_user_sessions_cache";

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
}

export function parseCookieString(input: string): { authToken?: string; ct0?: string } {
  const authToken = input.match(/auth_token=([0-9a-f]{20,})/i)?.[1];
  const ct0 = input.match(/ct0=([0-9a-f]{16,})/i)?.[1];
  return { authToken, ct0 };
}

/**
 * Retrieves sessions stored strictly in the user's browser local cache.
 * Each user has their own private cache. No credentials are saved globally in the shared app.
 */
export function getClientSessions(): ClientSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Auto-migrate if pre-seeded in session storage
      return [];
    }
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveClientSessions(sessions: ClientSession[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    // Trigger storage event for same-tab updates
    window.dispatchEvent(new Event("x_sessions_updated"));
  } catch (err) {
    console.warn("[session-store] Failed to save to local cache:", err);
  }
}

export function addClientSession(data: {
  label?: string;
  authToken: string;
  ct0: string;
  userAgent?: string;
}): ClientSession {
  const sessions = getClientSessions();
  const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const cleanAuth = data.authToken.replace(/^auth_token=/i, "").replace(/;.*$/, "").trim();
  const cleanCt0 = data.ct0.replace(/^ct0=/i, "").replace(/;.*$/, "").trim();

  // Deduplicate by auth_token
  const existingIdx = sessions.findIndex((s) => s.authToken === cleanAuth);
  if (existingIdx >= 0) {
    sessions[existingIdx].ct0 = cleanCt0;
    if (data.label) sessions[existingIdx].label = data.label.trim();
    saveClientSessions(sessions);
    return sessions[existingIdx];
  }

  const newSession: ClientSession = {
    id,
    label: data.label?.trim() || `Session #${sessions.length + 1}`,
    authToken: cleanAuth,
    ct0: cleanCt0,
    userAgent: data.userAgent?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  sessions.push(newSession);
  saveClientSessions(sessions);
  return newSession;
}

export function removeClientSession(id: string): void {
  const sessions = getClientSessions().filter((s) => s.id !== id);
  saveClientSessions(sessions);
}

export function clearAllClientSessions(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event("x_sessions_updated"));
}
