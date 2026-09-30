"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  Image as ImageIcon,
  Info,
  Maximize2,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import type { MediaItem } from "@/lib/x/types";
import { formatDate, formatDuration, largeImageUrl } from "@/lib/media-utils";
import { DownloadMenu } from "./DownloadMenu";
import { VideoPlayer } from "./VideoPlayer";

interface Props {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

export function Lightbox({ items, index, onClose, onNavigate }: Props) {
  const item = items[index];
  const [loaded, setLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showMeta, setShowMeta] = useState(false);

  const prev = useCallback(() => {
    if (index > 0) {
      setZoomLevel(1);
      onNavigate(index - 1);
    }
  }, [index, onNavigate]);

  const next = useCallback(() => {
    if (index < items.length - 1) {
      setZoomLevel(1);
      onNavigate(index + 1);
    }
  }, [index, items.length, onNavigate]);

  useEffect(() => {
    setLoaded(false);
    setZoomLevel(1);
  }, [item?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
      if (e.key === "i" || e.key === "I") setShowMeta((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, prev, next]);

  if (!item) return null;
  const TypeIcon = item.type === "photo" ? ImageIcon : item.type === "animated_gif" ? Sparkles : Film;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-neutral-950/95 backdrop-blur-xl animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Top Glass Navigation Bar */}
      <header
        className="flex items-center justify-between gap-3 border-b border-white/10 bg-neutral-900/80 px-4 py-3 text-sm text-neutral-200 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white shadow-lg shadow-sky-500/20">
            <TypeIcon size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 truncate font-semibold text-white">
              <span>@{item.username}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.2 text-[10px] font-normal uppercase text-neutral-400">
                {item.type}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-400">
              <Calendar size={12} />
              {formatDate(item.created_at, {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {item.duration_ms ? <span>· {formatDuration(item.duration_ms)}</span> : null}
              {item.width && item.height ? <span>· {item.width}×{item.height}</span> : null}
            </div>
          </div>
        </div>

        {/* Actions & Controls */}
        <div className="flex items-center gap-2">
          {/* Zoom controls for photos */}
          {item.type === "photo" && (
            <div className="hidden items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5 sm:flex">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(1, z - 0.25))}
                disabled={zoomLevel <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 disabled:opacity-30"
                title="Zoom out"
              >
                <ZoomOut size={15} />
              </button>
              <span className="px-1 text-[11px] font-medium text-neutral-400">
                {Math.round(zoomLevel * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                disabled={zoomLevel >= 3}
                className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10 disabled:opacity-30"
                title="Zoom in"
              >
                <ZoomIn size={15} />
              </button>
              {zoomLevel > 1 && (
                <button
                  type="button"
                  onClick={() => setZoomLevel(1)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-300 transition hover:bg-white/10"
                  title="Reset zoom"
                >
                  <RotateCcw size={13} />
                </button>
              )}
            </div>
          )}

          {/* Info toggle */}
          <button
            type="button"
            onClick={() => setShowMeta(!showMeta)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 transition ${
              showMeta ? "bg-sky-500 text-white" : "bg-white/5 text-neutral-300 hover:bg-white/10"
            }`}
            title="Toggle Details (I)"
          >
            <Info size={16} />
          </button>

          <span className="hidden text-xs font-semibold text-neutral-400 md:inline px-2">
            {index + 1} of {items.length}
          </span>

          <DownloadMenu item={item} variant="split" />

          <a
            href={item.original_post_url}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium transition hover:bg-white/10 hover:text-sky-300"
          >
            <ExternalLink size={14} /> <span className="hidden sm:inline">Post</span>
          </a>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-neutral-300 transition hover:bg-rose-500 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Media Stage */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-14">
        {/* Navigation Left */}
        <button
          type="button"
          aria-label="Previous"
          disabled={index === 0}
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/10 bg-black/60 p-3 text-white shadow-xl backdrop-blur-md transition hover:scale-110 hover:bg-sky-500 disabled:opacity-20 disabled:pointer-events-none sm:left-6"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Media Container */}
        <div
          className="flex max-h-full max-w-full items-center justify-center overflow-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {item.type === "photo" ? (
            <div className="relative flex max-h-[calc(100vh-220px)] max-w-full items-center justify-center overflow-hidden rounded-2xl">
              {!loaded && (
                <div className="absolute inset-0 m-auto h-12 w-12 animate-spin rounded-full border-3 border-white/20 border-t-sky-400" />
              )}
              <img
                key={item.id}
                src={largeImageUrl(item)}
                alt={item.caption}
                onLoad={() => setLoaded(true)}
                referrerPolicy="no-referrer"
                style={{ transform: `scale(${zoomLevel})` }}
                className={`max-h-[calc(100vh-220px)] max-w-full rounded-2xl object-contain shadow-2xl transition-all duration-300 ${
                  loaded ? "opacity-100" : "opacity-0"
                }`}
              />
            </div>
          ) : (
            <VideoPlayer
              key={item.id}
              item={item}
              className="flex max-h-[calc(100vh-220px)] w-full max-w-5xl items-center justify-center shadow-2xl"
            />
          )}
        </div>

        {/* Navigation Right */}
        <button
          type="button"
          aria-label="Next"
          disabled={index >= items.length - 1}
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/10 bg-black/60 p-3 text-white shadow-xl backdrop-blur-md transition hover:scale-110 hover:bg-sky-500 disabled:opacity-20 disabled:pointer-events-none sm:right-6"
        >
          <ChevronRight size={24} />
        </button>
      </div>

      {/* Metadata Slide-over or Drawer */}
      {showMeta && (
        <div
          className="border-t border-white/10 bg-neutral-900/90 px-6 py-3 text-xs text-neutral-300 backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-semibold text-white">Tweet ID:</span> {item.tweet_id}
            </div>
            <div>
              <span className="font-semibold text-white">Media ID:</span> {item.id}
            </div>
            <div>
              <span className="font-semibold text-white">Variants:</span> {item.download_variants.length} available
            </div>
            <div>
              <span className="font-semibold text-white">Dimensions:</span> {item.width} × {item.height}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Filmstrip / Thumbnails Bar */}
      <footer
        className="flex flex-col items-center gap-2 border-t border-white/10 bg-neutral-900/70 px-4 py-2.5 backdrop-blur-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Caption */}
        <p className="max-w-3xl truncate text-xs text-neutral-300" title={item.caption}>
          {item.caption || <span className="italic text-neutral-500">No caption</span>}
        </p>

        {/* Filmstrip preview */}
        <div className="flex items-center gap-2 overflow-x-auto py-1 max-w-full">
          {items.slice(Math.max(0, index - 4), Math.min(items.length, index + 5)).map((it) => {
            const realIdx = items.indexOf(it);
            const isSelected = realIdx === index;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => onNavigate(realIdx)}
                className={`relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-2 transition-all ${
                  isSelected
                    ? "ring-sky-400 scale-110 shadow-lg shadow-sky-500/30"
                    : "ring-white/10 opacity-60 hover:opacity-100 hover:ring-white/30"
                }`}
              >
                <img
                  src={it.thumbnail_url}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
                {it.type !== "photo" && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 p-0.5 text-white">
                    <Film size={8} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </footer>
    </div>
  );
}
