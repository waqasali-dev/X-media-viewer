import { scrapeProfileMedia, type ScraperMode } from "@/lib/x/scraper";
import type { StreamEvent } from "@/lib/x/types";

/**
 * Wraps the scraper generator in a Server-Sent Events response.
 * Each event is one `data:` line holding a JSON StreamEvent; a comment ping
 * is emitted every 15s so proxies keep the connection open.
 */
export function createStreamResponse(username: string, params: URLSearchParams, requestSignal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  requestSignal.addEventListener("abort", () => abort.abort(), { once: true });

  const modeParam = params.get("mode");
  const mode: ScraperMode | undefined =
    modeParam === "graphql" || modeParam === "playwright" || modeParam === "auto" ? modeParam : undefined;
  const full = params.get("full") === "1" || params.get("full") === "true";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (event: StreamEvent) => write(`data: ${JSON.stringify(event)}\n\n`);
      const heartbeat = setInterval(() => write(`: ping ${Date.now()}\n\n`), 15_000);
      write(`retry: 5000\n\n`);

      try {
        for await (const event of scrapeProfileMedia(username, { signal: abort.signal, mode, full })) {
          if (abort.signal.aborted) break;
          send(event);
        }
      } catch (err) {
        send({ type: "error", code: "stream_crashed", message: (err as Error).message || "Stream crashed" });
      } finally {
        clearInterval(heartbeat);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
