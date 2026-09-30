"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Download, Film, Image as ImageIcon } from "lucide-react";
import type { MediaItem } from "@/lib/x/types";
import { downloadHref } from "@/lib/media-utils";

interface Props {
  item: MediaItem;
  /** compact = icon button used on grid cards; split = primary button + chevron used in the lightbox */
  variant?: "compact" | "split";
  className?: string;
}

/**
 * Quality selector. Every entry hits /api/download so the browser receives a
 * Content-Disposition: attachment response instead of opening twimg.com in a tab.
 */
export function DownloadMenu({ item, variant = "compact", className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const variants = item.download_variants;
  const primary = variants[0];

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menuHeight = 44 * variants.length + 16;
    const up = rect.bottom + menuHeight > window.innerHeight - 8;
    const left = Math.min(Math.max(8, rect.right - 240), window.innerWidth - 248);
    setPos({ top: up ? rect.top - menuHeight - 6 : rect.bottom + 6, left, up });
  }, [open, variants.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || anchorRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  if (!primary) return null;

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[200] w-60 overflow-hidden rounded-xl border border-white/10 bg-neutral-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur"
      style={{ top: pos.top, left: pos.left }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Download quality</div>
      {variants.map((v) => (
        <a
          key={v.label + v.url}
          role="menuitem"
          href={downloadHref(item, v)}
          download
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-neutral-200 transition hover:bg-white/10"
          onClick={() => setOpen(false)}
        >
          {v.format.startsWith("video") ? <Film size={14} className="text-sky-400" /> : <ImageIcon size={14} className="text-emerald-400" />}
          <span className="flex-1 truncate">{v.label}</span>
          <span className="text-[10px] text-neutral-500">
            {v.width && v.height ? `${v.width}×${v.height}` : v.format.split("/")[1]?.toUpperCase()}
          </span>
        </a>
      ))}
    </div>
  ) : null;

  if (variant === "split") {
    return (
      <div ref={anchorRef} className={`inline-flex overflow-hidden rounded-lg bg-sky-500 text-white shadow-lg shadow-sky-500/20 ${className}`} onClick={(e) => e.stopPropagation()}>
        <a
          href={downloadHref(item, primary)}
          download
          className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold transition hover:bg-sky-400"
          title={`Download ${primary.label}`}
        >
          <Download size={16} />
          Download
          <span className="hidden text-sky-100/80 sm:inline">· {primary.label.split(" (")[0]}</span>
        </a>
        <button
          type="button"
          aria-label="Choose quality"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="border-l border-sky-300/40 px-2 transition hover:bg-sky-400"
        >
          <ChevronDown size={16} className={`transition ${open ? "rotate-180" : ""}`} />
        </button>
        {menu}
      </div>
    );
  }

  return (
    <div ref={anchorRef} className={className} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Download options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1 rounded-lg bg-black/60 px-2 text-xs font-medium text-white backdrop-blur transition hover:bg-sky-500"
      >
        <Download size={14} />
        <ChevronDown size={12} />
      </button>
      {menu}
    </div>
  );
}
