"use client";

import { memo, useRef, useState } from "react";
import { ExternalLink, Play, Sparkles } from "lucide-react";
import type { MediaItem } from "@/lib/x/types";
import { bestMp4, formatDate, formatDuration, mediaStreamHref } from "@/lib/media-utils";
import { DownloadMenu } from "./DownloadMenu";

interface Props {
  item: MediaItem;
  onOpen: () => void;
  mediaHeight: number;
}

/** One grid tile. Streams the thumbnail lazily from pbs.twimg.com; videos loop a muted low-res preview on hover. */
export const MediaCard = memo(function MediaCard({ item, onOpen, mediaHeight }: Props) {
  const [hover, setHover] = useState(false);
  const [broken, setBroken] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const isVideo = item.type !== "photo";

  // Determine preview URL (prefer preview_url, fallback to bestMp4, and proxy if direct fails)
  const directPreview = item.preview_url || bestMp4(item);
  const previewSource = previewError && directPreview ? mediaStreamHref(directPreview) : directPreview;

  return (
    <article
      className="group relative flex h-full cursor-zoom-in flex-col overflow-hidden rounded-2xl bg-neutral-900/90 ring-1 ring-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-sky-500/15 hover:ring-sky-400/60"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setPreviewError(false);
      }}
      onClick={onOpen}
    >
      <div className="relative w-full overflow-hidden bg-neutral-800/80" style={{ height: mediaHeight }}>
        {/* Shimmer loading placeholder */}
        {!imgLoaded && !broken && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-tr from-neutral-800 via-neutral-700/40 to-neutral-800" />
        )}

        {!broken ? (
          <img
            src={item.thumbnail_url}
            alt={item.caption ? item.caption.slice(0, 120) : `${item.type} by @${item.username}`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setImgLoaded(true)}
            onError={() => setBroken(true)}
            className={`h-full w-full object-cover transition-all duration-500 group-hover:scale-105 ${
              imgLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-500">
            Preview unavailable
          </div>
        )}

        {/* Video Hover Preview with Fallback */}
        {isVideo && hover && previewSource && (
          <video
            ref={(el) => {
              if (el) el.setAttribute("referrerpolicy", "no-referrer");
            }}
            src={previewSource}
            muted
            loop
            autoPlay
            playsInline
            preload="auto"
            onError={() => {
              if (!previewError) setPreviewError(true);
            }}
            className="absolute inset-0 h-full w-full object-cover animate-fade-in"
          />
        )}

        {/* Media type badge */}
        {isVideo && (
          <div className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur-md ring-1 ring-white/10">
            {item.type === "animated_gif" ? (
              <span className="flex items-center gap-1 text-purple-300">
                <Sparkles size={12} /> GIF
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sky-300">
                <Play size={11} fill="currentColor" /> {formatDuration(item.duration_ms) || "VIDEO"}
              </span>
            )}
            {hover && isVideo && (
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
            )}
          </div>
        )}

        {/* Center Play Button Overlay on Inactive Hover */}
        {isVideo && !hover && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20 transition-all duration-300 group-hover:bg-black/30">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white shadow-xl ring-1 ring-white/30 backdrop-blur-md transition duration-300 group-hover:scale-110 group-hover:bg-sky-500/90 group-hover:shadow-sky-500/30">
              <Play size={20} fill="currentColor" className="ml-0.5" />
            </span>
          </div>
        )}

        {/* Quick Download Menu */}
        <div className="absolute right-2.5 top-2.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 z-10">
          <DownloadMenu item={item} />
        </div>
      </div>

      {/* Footer bar */}
      <footer className="flex h-10 items-center justify-between gap-2 border-t border-white/5 bg-neutral-900/60 px-3 text-[11px] text-neutral-400">
        <span className="truncate font-medium text-neutral-300" title={item.caption}>
          {item.caption || <span className="italic text-neutral-500">No caption</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <time dateTime={item.created_at} className="text-neutral-500">
            {formatDate(item.created_at, { year: "2-digit", month: "short", day: "numeric" })}
          </time>
          <a
            href={item.original_post_url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1 text-neutral-400 transition hover:bg-white/10 hover:text-sky-400"
            title="Open post on X"
          >
            <ExternalLink size={13} />
          </a>
        </span>
      </footer>
    </article>
  );
});
