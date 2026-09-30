import { createStreamResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stream/:username – path-style alias of /api/stream?username= */
export async function GET(request: Request, ctx: { params: Promise<{ username: string }> }) {
  const { username } = await ctx.params;
  const url = new URL(request.url);
  return createStreamResponse(decodeURIComponent(username), url.searchParams, request.signal);
}
