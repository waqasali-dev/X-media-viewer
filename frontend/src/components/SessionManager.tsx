"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  KeyRound,
  Lock,
  Plus,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import {
  addClientSession,
  getClientSessions,
  maskToken,
  parseCookieString,
  removeClientSession,
  type ClientSession,
} from "@/lib/session-store";

interface Counts {
  active: number;
  total: number;
}

interface Props {
  onClose: () => void;
  onChanged?: (counts: Counts) => void;
}

export function SessionManager({ onClose, onChanged }: Props) {
  const [sessions, setSessions] = useState<ClientSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [ct0, setCt0] = useState("");
  const [cookieString, setCookieString] = useState("");
  const [activeTab, setActiveTab] = useState<"pool" | "help">("pool");

  const refresh = useCallback(() => {
    const list = getClientSessions();
    setSessions(list);
    onChanged?.({ active: list.length, total: list.length });
  }, [onChanged]);

  useEffect(() => {
    refresh();
    const handleUpdate = () => refresh();
    window.addEventListener("x_sessions_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("x_sessions_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    let finalAuth = authToken.trim();
    let finalCt0 = ct0.trim();

    if (cookieString.trim() && (!finalAuth || !finalCt0)) {
      const parsed = parseCookieString(cookieString);
      finalAuth ||= parsed.authToken ?? "";
      finalCt0 ||= parsed.ct0 ?? "";
    }

    finalAuth = finalAuth.replace(/^auth_token=/i, "").replace(/;.*$/, "").trim();
    finalCt0 = finalCt0.replace(/^ct0=/i, "").replace(/;.*$/, "").trim();

    if (!/^[0-9a-f]{20,}$/i.test(finalAuth)) {
      setError("auth_token looks invalid – it should be a 40-character hex string.");
      return;
    }
    if (!/^[0-9a-f]{16,}$/i.test(finalCt0)) {
      setError("ct0 looks invalid – copy the full value of the ct0 cookie.");
      return;
    }

    addClientSession({
      label: label.trim() || undefined,
      authToken: finalAuth,
      ct0: finalCt0,
    });

    setLabel("");
    setAuthToken("");
    setCt0("");
    setCookieString("");
    setNotice("Session saved to your private browser cache.");
    refresh();
  };

  const remove = (id: string) => {
    removeClientSession(id);
    refresh();
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
                <h2 className="text-base font-bold text-white">Your Private Session Cache</h2>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <Lock size={10} /> Local Cache Only
                </span>
              </div>
              <p className="text-xs text-neutral-400">
                Credentials are saved <strong className="text-emerald-300">strictly in your browser</strong>. Never saved on the server, in files, or shared with other visitors.
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
              Your credentials are used solely by your browser to authenticate media timeline requests. No one else has access to your session.
            </p>
            <ol className="list-decimal space-y-2 rounded-2xl border border-white/10 bg-white/[0.02] p-5 pl-8 text-xs leading-relaxed text-neutral-300">
              <li>Log in to <strong className="text-white">https://x.com</strong> in your browser (Chrome, Edge, or Firefox).</li>
              <li>Open Browser Developer Tools by pressing <kbd>F12</kbd> (or right click &gt; Inspect).</li>
              <li>Go to <strong className="text-white">Application</strong> tab (in Firefox: <strong className="text-white">Storage</strong>) &gt; <strong className="text-white">Cookies</strong> &gt; <code className="text-sky-300">https://x.com</code>.</li>
              <li>Locate the cookie named <code className="font-mono text-amber-300 font-bold">auth_token</code> and copy its 40-character hexadecimal value.</li>
              <li>Locate the cookie named <code className="font-mono text-amber-300 font-bold">ct0</code> (the CSRF token) and copy its value.</li>
              <li>Paste both keys into the Add Session form, or paste the entire <code className="text-sky-300">Cookie:</code> header into the text box.</li>
            </ol>
            <button
              type="button"
              onClick={() => setActiveTab("pool")}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white shadow-lg transition hover:bg-sky-400"
            >
              Back to Session Cache
            </button>
          </div>
        ) : (
          <div className="grid gap-6 p-6 md:grid-cols-5">
            {/* Add Session Form */}
            <form onSubmit={submit} className="space-y-3.5 md:col-span-2">
              <h3 className="text-sm font-bold text-white flex items-center justify-between">
                <span>Add Private Session</span>
              </h3>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                  Label
                </label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. My Account"
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
                  <span className="h-px flex-1 bg-white/10" /> or paste raw Cookie header <span className="h-px flex-1 bg-white/10" />
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
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-sky-500/25 transition hover:brightness-110 active:scale-95"
              >
                <Plus size={16} /> Save to My Cache
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
                <h3 className="text-sm font-bold text-white">Your Saved Sessions ({sessions.length})</h3>
                <span className="text-[11px] text-neutral-400">Stored in your browser only</span>
              </div>

              {sessions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-xs text-neutral-400 space-y-2">
                  <div className="text-neutral-300 font-semibold">No sessions saved in your browser</div>
                  <p>
                    Add your <code className="text-sky-300">auth_token</code> + <code className="text-sky-300">ct0</code> to start streaming media timelines.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {sessions.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 shadow-sm transition hover:border-white/20"
                    >
                      <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <span className="truncate">{s.label}</span>
                          <span className="rounded-md bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[10px] uppercase font-bold text-emerald-300">
                            Ready
                          </span>
                        </div>
                        <div className="truncate font-mono text-[11px] text-neutral-400 mt-0.5">
                          auth: {maskToken(s.authToken)} · ct0: {maskToken(s.ct0)}
                        </div>
                      </div>

                      <button
                        type="button"
                        title="Remove from my cache"
                        onClick={() => remove(s.id)}
                        className="rounded-xl border border-white/10 bg-white/5 p-2 text-neutral-400 transition hover:bg-rose-500/20 hover:text-rose-300"
                      >
                        <Trash2 size={14} />
                      </button>
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
