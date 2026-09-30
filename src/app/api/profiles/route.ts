import { deleteProfile, getProfile, listProfiles, profileToState, queryCachedMedia } from "@/lib/x/repository";
import { normalizeHandle } from "@/lib/x/constants";
import type { MediaType } from "@/lib/x/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/profiles                      → recently archived profiles
 * GET /api/profiles?username=x&media=1   → paginated cached media (&type=&order=&offset=&limit=)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const username = searchParams.get("username");
    if (!username) {
      const rows = await listProfiles(30);
      return Response.json({ profiles: rows.map(profileToState) });
    }
    const handle = normalizeHandle(username);
    if (!handle) return Response.json({ error: "Invalid handle" }, { status: 400 });
    const profile = await getProfile(handle);
    if (!profile) return Response.json({ error: "Profile not cached yet" }, { status: 404 });
    if (searchParams.get("media") !== "1") return Response.json({ profile: profileToState(profile) });

    const type = (searchParams.get("type") as MediaType | "all" | null) ?? "all";
    const order = searchParams.get("order") === "oldest" ? "oldest" : "newest";
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
    const limit = Math.min(500, Math.max(1, Number(searchParams.get("limit")) || 200));
    const result = await queryCachedMedia({ profileId: profile.id, type, order, offset, limit });
    return Response.json({ profile: profileToState(profile), ...result, offset, limit });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

/** DELETE /api/profiles?username=x – purge the cached archive for a handle. */
export async function DELETE(request: Request) {
  try {
    const handle = normalizeHandle(new URL(request.url).searchParams.get("username") ?? "");
    if (!handle) return Response.json({ error: "Invalid handle" }, { status: 400 });
    await deleteProfile(handle);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
