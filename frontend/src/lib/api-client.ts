/**
 * Client helper to resolve API URLs.
 * When NEXT_PUBLIC_BACKEND_URL is set (e.g. on Vercel pointing to Render),
 * requests hit the external backend directly.
 * Otherwise, relative paths are used (works with Next.js rewrites or same-domain).
 */
export const BACKEND_URL = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

export function getApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!BACKEND_URL) return normalized;
  return `${BACKEND_URL}${normalized}`;
}
