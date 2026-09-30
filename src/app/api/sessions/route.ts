import {
  addSession,
  countUsableSessions,
  deleteSession,
  listSessions,
  resetSession,
  syncExternalSessions,
} from "@/lib/x/session-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function payload() {
  const [sessions, counts] = await Promise.all([listSessions(), countUsableSessions()]);
  return { sessions, counts };
}

/** GET /api/sessions – list the cookie pool (tokens are masked). */
export async function GET() {
  try {
    return Response.json(await payload());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** Extracts auth_token / ct0 from a raw `document.cookie` or Cookie header paste. */
function parseCookieString(input: string): { authToken?: string; ct0?: string } {
  const authToken = input.match(/auth_token=([0-9a-f]{20,})/i)?.[1];
  const ct0 = input.match(/ct0=([0-9a-f]{16,})/i)?.[1];
  return { authToken, ct0 };
}

/**
 * POST /api/sessions
 *   { label?, auth_token, ct0 }            → add / update a session
 *   { cookie_string }                      → parse a pasted cookie header
 *   { action: "import" }                   → re-import cookies.json / env
 *   { action: "reset", id }                → clear cooldown / invalid flag
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (body.action === "import") {
      const imported = await syncExternalSessions(true);
      return Response.json({ imported, ...(await payload()) });
    }
    if (body.action === "reset" && typeof body.id === "number") {
      await resetSession(body.id);
      return Response.json(await payload());
    }

    let authToken = typeof body.auth_token === "string" ? body.auth_token.trim() : "";
    let ct0 = typeof body.ct0 === "string" ? body.ct0.trim() : "";
    if (typeof body.cookie_string === "string" && (!authToken || !ct0)) {
      const parsed = parseCookieString(body.cookie_string);
      authToken ||= parsed.authToken ?? "";
      ct0 ||= parsed.ct0 ?? "";
    }
    // Tolerate users pasting `auth_token=xxx` style values
    authToken = authToken.replace(/^auth_token=/i, "").replace(/;.*$/, "");
    ct0 = ct0.replace(/^ct0=/i, "").replace(/;.*$/, "");

    if (!/^[0-9a-f]{20,}$/i.test(authToken)) {
      return Response.json({ error: "auth_token looks invalid – it should be a 40-character hex string." }, { status: 400 });
    }
    if (!/^[0-9a-f]{16,}$/i.test(ct0)) {
      return Response.json({ error: "ct0 looks invalid – copy the full value of the ct0 cookie." }, { status: 400 });
    }
    const session = await addSession({
      label: typeof body.label === "string" ? body.label : undefined,
      authToken,
      ct0,
      userAgent: typeof body.user_agent === "string" ? body.user_agent : undefined,
    });
    return Response.json({ added: session.id, ...(await payload()) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE /api/sessions?id=123 */
export async function DELETE(request: Request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return Response.json({ error: "id required" }, { status: 400 });
    await deleteSession(id);
    return Response.json(await payload());
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
