/**
 * Static knowledge about X's internal (web client) GraphQL API.
 * Nothing here is an official API key: the bearer token below is the public
 * token embedded in every x.com web bundle, and operation IDs are the query
 * hashes shipped in main.*.js. Operation IDs rotate over time, so they can be
 * overridden via env vars or refreshed at runtime (see operations.ts).
 */

export const GQL_URL = "https://x.com/i/api/graphql";

export const PUBLIC_BEARER_TOKEN =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

export type OperationName = "UserByScreenName" | "UserByRestId" | "UserMedia";

export const DEFAULT_OPERATION_IDS: Record<OperationName, string> = {
  UserByScreenName: process.env.X_OP_USER_BY_SCREEN_NAME || "Gb-d6r0vxPOADdG62OEBpQ",
  UserByRestId: process.env.X_OP_USER_BY_REST_ID || "xvmVfRLmnr1alc5f2dib0Q",
  UserMedia: process.env.X_OP_USER_MEDIA || "VyudDWQnr9vJNw7GasFz2g",
};

/** Feature flags the web client sends. Missing flags produce HTTP 400 – the client auto-heals those. */
export const GQL_FEATURES: Record<string, boolean> = {
  articles_preview_enabled: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_media_download_video_enabled: false,
  responsive_web_profile_redirect_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  rweb_video_timestamps_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_awards_web_tipping_enabled: false,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweet_with_visibility_results_prefer_gql_media_interstitial_enabled: false,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  premium_content_api_read_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_grok_share_attachment_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_analysis_button_from_backend: false,
  responsive_web_jetfuel_frame: false,
  rweb_video_screen_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  hidden_profile_subscriptions_enabled: true,
  hidden_profile_likes_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  subscriptions_feature_can_gift_premium: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  payments_enabled: false,
};

export const USER_FIELD_TOGGLES = { withAuxiliaryUserLabels: false };

/** Browser fingerprints rotated per request (UA + matching client hints). */
export const BROWSER_PROFILES: { ua: string; secChUa: string; platform: string }[] = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    platform: '"Windows"',
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    secChUa: '"Google Chrome";v="135", "Not-A.Brand";v="8", "Chromium";v="135"',
    platform: '"macOS"',
  },
  {
    ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="134", "Not:A-Brand";v="24", "Google Chrome";v="134"',
    platform: '"Linux"',
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 Edg/137.0.0.0",
    secChUa: '"Microsoft Edge";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
    platform: '"Windows"',
  },
];

export const PAGE_SIZE = Math.min(100, Math.max(20, Number(process.env.X_PAGE_SIZE) || 100));
export const RATE_LIMIT_COOLDOWN_SECONDS = Number(process.env.X_COOLDOWN_SECONDS) || 60;
export const JITTER_MIN_MS = 1200;
export const JITTER_MAX_MS = 2800;

export const ALLOWED_DOWNLOAD_HOSTS = ["pbs.twimg.com", "video.twimg.com", "abs.twimg.com", "ton.twimg.com"];

const RESERVED_PATHS = new Set([
  "i", "home", "explore", "search", "settings", "messages", "notifications", "compose",
  "login", "signup", "tos", "privacy", "about", "hashtag", "intent", "share", "account",
]);

/**
 * Accepts `@handle`, `handle`, `https://x.com/handle`, `twitter.com/handle/media`,
 * `mobile.twitter.com/handle?s=20` ... and returns the clean lower-cased handle.
 */
export function normalizeHandle(raw: string): string | null {
  let value = (raw || "").trim();
  if (!value) return null;
  value = value.replace(/^@+/, "");
  if (/^(https?:\/\/)?([\w-]+\.)*(x|twitter)\.com/i.test(value)) {
    try {
      const url = new URL(value.startsWith("http") ? value : `https://${value}`);
      const [first] = url.pathname.split("/").filter(Boolean);
      if (!first) return null;
      value = first.replace(/^@+/, "");
    } catch {
      return null;
    }
  }
  if (/\s/.test(value)) return null;
  value = value.split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) return null;
  if (RESERVED_PATHS.has(value.toLowerCase())) return null;
  return value.toLowerCase();
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(t);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
