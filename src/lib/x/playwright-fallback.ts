import { BROWSER_PROFILES, JITTER_MAX_MS, JITTER_MIN_MS, randomBetween, sleep } from "./constants";
import type { SessionCookie } from "./types";

/**
 * Mode B: headless Chromium (playwright-core) navigates to https://x.com/{user}/media,
 * scrolls like a human and captures every `UserMedia` GraphQL payload the page loads.
 *
 * Requirements (optional, only for this fallback):
 *   npx playwright install chromium            – or –
 *   PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome   (any Chromium/Chrome binary)
 */

const STEALTH_INIT_SCRIPT = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = window.chrome || { runtime: {}, loadTimes() {}, csi() {}, app: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (p) =>
      p && p.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
  }
  try {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, param);
    };
  } catch {}
`;

function createQueue<T>() {
  const buffer: T[] = [];
  let notify: (() => void) | null = null;
  return {
    push(value: T) {
      buffer.push(value);
      notify?.();
      notify = null;
    },
    async next(timeoutMs: number, signal?: AbortSignal): Promise<T | undefined> {
      if (buffer.length) return buffer.shift();
      await Promise.race([new Promise<void>((r) => (notify = r)), sleep(timeoutMs, signal)]);
      return buffer.shift();
    },
    size() {
      return buffer.length;
    },
  };
}

export interface PlaywrightPage {
  json: unknown;
  url: string;
}

export async function* playwrightUserMediaPages(
  username: string,
  session: SessionCookie,
  signal?: AbortSignal,
): AsyncGenerator<PlaywrightPage> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new Error("playwright-core is not installed – run `npm i playwright-core && npx playwright install chromium`.");
  }

  const fp = BROWSER_PROFILES[randomBetween(0, BROWSER_PROFILES.length)];
  let browser: import("playwright-core").Browser;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    throw new Error(
      `Could not launch Chromium for the Playwright fallback (${(err as Error).message.split("\n")[0]}). ` +
        "Run `npx playwright install chromium` or set PLAYWRIGHT_CHROMIUM_PATH.",
    );
  }

  const queue = createQueue<PlaywrightPage>();
  try {
    const context = await browser.newContext({
      userAgent: session.userAgent || fp.ua,
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });
    await context.addCookies([
      { name: "auth_token", value: session.authToken, domain: ".x.com", path: "/", httpOnly: true, secure: true, sameSite: "None" },
      { name: "ct0", value: session.ct0, domain: ".x.com", path: "/", secure: true, sameSite: "Lax" },
    ]);
    await context.addInitScript(STEALTH_INIT_SCRIPT);
    const page = await context.newPage();

    page.on("response", (res) => {
      const url = res.url();
      if (!/\/graphql\/[^/]+\/UserMedia/.test(url) || res.status() !== 200) return;
      res
        .json()
        .then((json) => queue.push({ json, url }))
        .catch(() => undefined);
    });

    await page.goto(`https://x.com/${username}/media`, { waitUntil: "domcontentloaded", timeout: 60_000 });

    let idleRounds = 0;
    let lastHeight = 0;
    while (!signal?.aborted) {
      const next = await queue.next(8_000, signal);
      if (next) {
        idleRounds = 0;
        yield next;
        // drain anything else that already arrived
        let more: PlaywrightPage | undefined;
        while ((more = await queue.next(0, signal))) yield more;
      } else {
        idleRounds++;
      }
      if (idleRounds >= 4) break;

      // Human-like scrolling with jitter
      await page.mouse.move(randomBetween(200, 900), randomBetween(200, 700));
      await page.mouse.wheel(0, randomBetween(2200, 3800));
      await sleep(randomBetween(JITTER_MIN_MS, JITTER_MAX_MS), signal);
      try {
        await page.waitForLoadState("networkidle", { timeout: 4_000 });
      } catch {
        /* still loading – fine */
      }
      const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
      if (height === lastHeight) idleRounds++;
      lastHeight = height;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
