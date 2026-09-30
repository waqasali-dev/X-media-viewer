"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { MediaItem } from "@/lib/x/types";
import { aspectRatio, columnsForWidth } from "@/lib/media-utils";
import { MediaCard } from "./MediaCard";

const GAP = 12;
const FOOTER_H = 36;

interface Props {
  items: MediaItem[];
  onOpen: (index: number) => void;
}

/**
 * Virtualized masonry: TanStack Virtual assigns each card to the shortest lane and
 * only the ~3 viewports around the scroll position are mounted, so 5,000+ items
 * cost nothing. Card heights come from the media's real width/height, so no
 * DOM measurement is required.
 */
export function MediaGrid({ items, onOpen }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      setWidth(el.clientWidth);
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const lanes = columnsForWidth(width || 1200);
  const colWidth = width > 0 ? (width - GAP * (lanes - 1)) / lanes : 0;

  const heights = useMemo(
    () => items.map((item) => Math.round(colWidth * aspectRatio(item)) + FOOTER_H),
    [items, colWidth],
  );

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: (i) => heights[i] ?? 300,
    overscan: 12,
    lanes,
    gap: GAP,
    scrollMargin,
    getItemKey: (i) => items[i]?.id ?? i,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (el) setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colWidth, lanes, heights]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div ref={containerRef} className="relative w-full">
      {width > 0 && (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualItems.map((v) => {
            const item = items[v.index];
            if (!item) return null;
            return (
              <div
                key={v.key}
                data-index={v.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: v.lane * (colWidth + GAP),
                  width: colWidth,
                  height: v.size,
                  transform: `translateY(${v.start - scrollMargin}px)`,
                }}
              >
                <MediaCard item={item} mediaHeight={v.size - FOOTER_H} onOpen={() => onOpen(v.index)} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
