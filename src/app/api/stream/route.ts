import { createStreamResponse } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/stream?username=<handle|url>[&mode=auto|graphql|playwright][&full=1] */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = url.searchParams.get("username") ?? url.searchParams.get("u") ?? "";
  return createStreamResponse(username, url.searchParams, request.signal);
}
