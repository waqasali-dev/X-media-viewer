"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getApiUrl } from "@/lib/api-client";

interface SessionView {
  id: number;
  label: string;
  status: string;
  cooldownUntil: string | null;
  requestsCount: number;
  lastUsedAt: string | null;
  lastError: string | null;
  authTokenMasked: string;
  ct0Masked: string;
}

interface Counts {
  active: number;
  cooldown: number;
  invalid: number;
  total: number;
}

interface Props {
  onClose: () => void;
  onChanged?: (counts: Counts) => void;
}

export function SessionManager({ onClose, onChanged }: Props) {
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [cookieString, setCookieString] = useState("");
  const [activeTab, setActiveTab] = useState<"pool" | "help">("pool");

  const apply = useCallback(
    (data: { sessions?: SessionView[]; counts?: Counts; error?: string; imported?: number }) => {
      if (data.error) {
        setError(data.error);
        return;
      }
      if (data.sessions) setSessions(data.sessions);
      if (data.counts) {
        setCounts(data.counts);
        onChanged?.(data.counts);
      }
      if (typeof data.imported === "number")
        setNotice(`Imported ${data.imported} new session(s) from cookies.json / env.`);
    },
    [onChanged],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      apply(await (await fetch(getApiUrl("/api/sessions"))).json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(getApiUrl("/api/sessions"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      apply(data);
      return !data.error;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await post({ label, auth_token: authToken, ct0, cookie_string: cookieString });
    if (ok) {
      setLabel("");
      setAuthToken("");
      setCt0("");
      setCookieString("");
      setNotice("Session added to the pool.");
    }
  };

  const remove = async (id: number) => {
    setBusy(true);
    try {
      apply(await (await fetch(getApiUrl(`/api/sessions?id=${id}`), { method: "DELETE" })).json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md sm:p-8 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-white/10 bg-neutral-950 shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 bg-neutral-900/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/25">
              <KeyRound size={20} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">X Cookie Session Pool</h2>
                <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold text-sky-400 border border-sky-500/20">
                  {counts?.total ?? 0} Total
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Rotates logged-in X accounts to bypass rate limits and fetch media.
                {counts && (
                  <>
                    {" "}
                    · <span className="font-semibold text-emerald-400">{counts.active} active</span>,{" "}
                    <span className="font-semibold text-amber-400">{counts.cooldown} cooling</span>,{" "}
                    <span className="font-semibold text-rose-400">{counts.invalid} invalid</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === "pool" ? "help" : "pool")}
              className={`flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === "help"
                  ? "bg-sky-500 text-white shadow-md shadow-sky-500/20"
                  : "bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              <HelpCircle size={14} /> Guide
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {activeTab === "help" ? (
          <div className="p-6 space-y-4 text-sm text-neutral-300">
            <div className="flex items-center gap-2 text-base font-bold text-white">
              <Shield size={18} className="text-sky-400" />
              How to retrieve your `auth_token` and `ct0`
            </div>
            <p className="text-xs leading-relaxed text-neutral-400">
              For security, using a secondary or burner X account is strongly recommended.
            </p>
            <ol className="list-decimal space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-5 pl-8 text-xs leading-relaxed text-neutral-300">
              <li>Log in to <strong className="text-white">https://x.com</strong> in your browser (Chrome, Edge, or Firefox).</li>
              <li>Open Browser Developer Tools by pressing <kbd>F12</kbd> (or right click &gt; Inspect).</li>
              <li>Go to <strong className="text-white">Application</strong> tab (in Firefox: <strong className="text-white">Storage</strong>) &gt; <strong className="text-white">Cookies</strong> &gt; <code className="text-sky-300">https://x.com</code>.</li>
              <li>Locate the cookie named <code className="font-mono text-amber-300 font-bold">auth_token</code> and copy its 40-character hexadecimal value.</li>
              <li>Locate the cookie named <code className="font-mono text-amber-300 font-bold">ct0</code> (the CSRF token) and copy its value.</li>
              <li>Paste both keys into the Add Session form, or paste the entire <code className="text-sky-300">Cookie:</code> header into the text box.</li>
              <li>You can also configure <code className="text-sky-300">cookies.json</code> in the project directory for persistent pool loading.</li>
            </ol>
            <button
              type="button"
              onClick={() => setActiveTab("pool")}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white shadow-lg transition hover:bg-sky-400"
            >
              Back to Session Pool
            </button>
          </div>
        ) : (
          <div className="grid gap-6 p-6 md:grid-cols-5">
            {/* Add Session Form */}
            <form onSubmit={submit} className="space-y-3.5 md:col-span-2">
              <h3 className="text-sm font-bold text-white">Add Session</h3>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Label
                </label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Burner #1"
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  auth_token
                </label>
                <input
                  value={authToken}
                  onChange={(e) => setAuthToken(e.target.value)}
                  placeholder="40-character hex string"
                  className="input font-mono text-xs"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  ct0 (CSRF)
                </label>
                <input
                  value={ct0}
                  onChange={(e) => setCt0(e.target.value)}
                  placeholder="CSRF token hex string"
                  className="input font-mono text-xs"
                  autoComplete="off"
                />
              </div>

              <div className="relative pt-1">
                <div className="my-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
                  <span className="h-px flex-1 bg-white/10" /> or paste raw header <span className="h-px flex-1 bg-white/10" />
                </div>
                <textarea
                  value={cookieString}
                  onChange={(e) => setCookieString(e.target.value)}
                  placeholder="auth_token=...; ct0=...;"
                  rows={2}
                  className="input resize-none font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                Add Session
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => post({ action: "import" })}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                <Upload size={14} /> Import from cookies.json / env
              </button>

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300 animate-fade-in">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {notice && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs text-emerald-300 animate-fade-in">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  <span>{notice}</span>
                </div>
              )}
            </form>

            {/* Configured Sessions List */}
            <div className="md:col-span-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Configured Sessions</h3>
                <button
                  type="button"
                  onClick={load}
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-400 transition hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 p-10 text-neutral-500">
                  <Loader2 size={24} className="animate-spin text-sky-400 mb-2" />
                  <span className="text-xs">Loading sessions…</span>
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-neutral-400 space-y-2">
                  <div className="text-neutral-300 font-semibold">No active sessions in the pool</div>
                  <p>
                    Add at least one <code className="text-sky-300">auth_token</code> + <code className="text-sky-300">ct0</code> pair to start scraping media streams.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-sm transition hover:border-white/20"
                    >
                      <StatusDot status={s.status} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <span className="truncate">{s.label}</span>
                          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] uppercase font-bold text-neutral-300">
                            {s.status}
                          </span>
                        </div>
                        <div className="truncate font-mono text-[11px] text-neutral-400 mt-0.5">
                          auth: {s.authTokenMasked} · ct0: {s.ct0Masked} · {s.requestsCount} reqs
                          {s.lastUsedAt ? ` · used ${new Date(s.lastUsedAt).toLocaleTimeString()}` : ""}
                        </div>
                        {s.lastError && (
                          <div className="truncate text-[11px] text-amber-400/90 mt-0.5">
                            {s.lastError}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        {s.status !== "active" && (
                          <button
                            type="button"
                            title="Re-activate session"
                            onClick={() => post({ action: "reset", id: s.id })}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-300 transition hover:bg-white/15 hover:text-white"
                          >
                            <RefreshCw size={14} />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Remove session"
                          onClick={() => remove(s.id)}
                          className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  if (status === "active")
    return <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />;
  if (status === "cooldown")
    return <Clock size={18} className="shrink-0 text-amber-400" />;
  return <AlertTriangle size={18} className="shrink-0 text-rose-400" />;
}
