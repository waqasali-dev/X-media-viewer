"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { MediaItem, DownloadVariant } from "@/lib/x/types";
import { bestMp4, formatDuration, mediaStreamHref } from "@/lib/media-utils";

interface Props {
  item: MediaItem;
  className?: string;
}

/**
 * High-performance, robust video player.
 * - Multi-tiered fallback: HLS -> direct MP4 -> inline streaming proxy (/api/download?inline=1)
 * - Browser autoplay policy recovery: unmuted -> muted autoplay with click-to-unmute banner
 * - Custom controls with quality switcher, timeline seeker, speed, volume, and fullscreen
 */
export function VideoPlayer({ item, className = "" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const seekHoverRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isGif = item.type === "animated_gif";

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.duration_ms ? item.duration_ms / 1000 : 0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(isGif);
  const [autoplayBlockedSound, setAutoplayBlockedSound] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [sourceType, setSourceType] = useState<"hls" | "mp4" | "proxy">("mp4");
  const [activeQuality, setActiveQuality] = useState<string>("auto");
  const [isLooping, setIsLooping] = useState(isGif);

  // Filter video variants
  const mp4Variants = item.download_variants.filter((v) => v.format === "video/mp4");

  // Format second timestamps
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Keep controls active on interaction
  const wakeControls = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowSettings(false);
      }, 2500);
    }
  }, [isPlaying]);

  // Boot playback engine with HLS / MP4 / Proxy fallbacks
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.setAttribute("referrerpolicy", "no-referrer");
    let disposed = false;
    let hlsInstance: any = null;

    const playWithAutoplayHandling = async () => {
      if (disposed) return;
      try {
        await video.play();
        setIsPlaying(true);
        setAutoplayBlockedSound(false);
      } catch (err: any) {
        // Autoplay with sound was blocked by browser - fallback to muted playback
        if (!isGif) {
          video.muted = true;
          setIsMuted(true);
          setAutoplayBlockedSound(true);
          try {
            await video.play();
            setIsPlaying(true);
          } catch {
            setIsPlaying(false);
          }
        }
      }
    };

    const attachMp4Source = (url: string, useProxyFallback = false) => {
      if (disposed) return;
      hlsInstance?.destroy();
      hlsInstance = null;

      const finalUrl = useProxyFallback ? mediaStreamHref(url) : url;
      setSourceType(useProxyFallback ? "proxy" : "mp4");
      video.src = finalUrl;
      video.load();

      // If direct CDN fails to load or triggers network error, fallback to proxy
      if (!useProxyFallback) {
        video.onerror = () => {
          if (!disposed) {
            console.warn("Direct video load failed, switching to streaming proxy...");
            attachMp4Source(url, true);
          }
        };
      } else {
        video.onerror = null;
      }

      void playWithAutoplayHandling();
    };

    const boot = async () => {
      setIsBuffering(true);
      const stream = item.video_stream_url;
      const mp4 = bestMp4(item) || item.download_variants[0]?.url;

      // 1. Try Native HLS (Safari / iOS)
      if (!isGif && stream && stream.includes(".m3u8") && video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = stream;
        setSourceType("hls");
        video.addEventListener("error", () => attachMp4Source(mp4 || stream, true), { once: true });
        void playWithAutoplayHandling();
        return;
      }

      // 2. Try HLS.js (Chrome / Firefox / Edge)
      if (!isGif && stream && stream.includes(".m3u8")) {
        try {
          const mod = await import("hls.js/dist/hls.min.js");
          const Hls = (mod.default || mod) as any;
          if (Hls && Hls.isSupported && Hls.isSupported()) {
            hlsInstance = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              capLevelToPlayerSize: true,
            });
            hlsInstance.on(Hls.Events.ERROR, (_evt: any, data: any) => {
              if (data.fatal) {
                console.warn("HLS fatal error, falling back to MP4...", data.details);
                attachMp4Source(mp4 || stream, false);
              }
            });
            hlsInstance.loadSource(stream);
            hlsInstance.attachMedia(video);
            setSourceType("hls");
            void playWithAutoplayHandling();
            return;
          }
        } catch {
          // Hls.js fallback
        }
      }

      // 3. Progressive MP4 with fallback
      if (mp4) {
        attachMp4Source(mp4, false);
      } else if (stream) {
        attachMp4Source(stream, true);
      }
    };

    void boot();

    return () => {
      disposed = true;
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      hlsInstance?.destroy();
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
    };
  }, [item, isGif]);

  // Video event listeners
  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (!duration || isNaN(duration)) {
      setDuration(video.duration);
    }
    if (video.buffered.length > 0) {
      setBufferedEnd(video.buffered.end(video.buffered.length - 1));
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
    wakeControls();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    setAutoplayBlockedSound(false);
    if (!nextMuted && video.volume === 0) {
      video.volume = 0.5;
      setVolume(0.5);
    }
    wakeControls();
  };

  const onVolumeChange = (newVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = newVol;
    setVolume(newVol);
    video.muted = newVol === 0;
    setIsMuted(newVol === 0);
    setAutoplayBlockedSound(false);
    wakeControls();
  };

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = percent * duration;
    setCurrentTime(percent * duration);
    wakeControls();
  };

  const skipSeconds = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(duration || Infinity, video.currentTime + seconds));
    wakeControls();
  };

  const selectQuality = (variant: DownloadVariant | "auto") => {
    const video = videoRef.current;
    if (!video) return;
    const currTime = video.currentTime;
    const wasPlaying = !video.paused;

    if (variant === "auto") {
      setActiveQuality("auto");
      const defaultMp4 = bestMp4(item);
      if (defaultMp4) {
        video.src = defaultMp4;
        video.currentTime = currTime;
        if (wasPlaying) void video.play();
      }
    } else {
      setActiveQuality(variant.label);
      video.src = variant.url;
      video.currentTime = currTime;
      if (wasPlaying) void video.play();
    }
    setShowSettings(false);
    wakeControls();
  };

  const changeSpeed = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
    setShowSettings(false);
    wakeControls();
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (!document.fullscreenElement) {
      void container.requestFullscreen().then(() => setIsFullscreen(true));
    } else {
      void document.exitFullscreen().then(() => setIsFullscreen(false));
    }
    wakeControls();
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowLeft" || e.key === "j") {
        e.preventDefault();
        skipSeconds(-5);
      } else if (e.key === "ArrowRight" || e.key === "l") {
        e.preventDefault();
        skipSeconds(5);
      } else if (e.key === "m") {
        e.preventDefault();
        toggleMute();
      } else if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const progressPercent = duration ? (currentTime / duration) * 100 : 0;
  const bufferPercent = duration ? (bufferedEnd / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={wakeControls}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className={`group relative flex items-center justify-center overflow-hidden rounded-xl bg-black select-none ${className}`}
    >
      {/* Video Element */}
      <video
        ref={videoRef}
        poster={item.display_url}
        playsInline
        loop={isLooping}
        muted={isMuted}
        preload="auto"
        onClick={togglePlay}
        onTimeUpdate={onTimeUpdate}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          if (!isLooping) setIsPlaying(false);
        }}
        className="max-h-[calc(100vh-210px)] max-w-full cursor-pointer object-contain outline-none"
        style={{ aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : undefined }}
      />

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-sky-400 shadow-2xl ring-1 ring-white/10">
            <Loader2 size={32} className="animate-spin" />
          </div>
        </div>
      )}

      {/* Big Center Play Icon when paused and not buffering */}
      {!isPlaying && !isBuffering && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 m-auto flex h-18 w-18 items-center justify-center rounded-full bg-sky-500/90 text-white shadow-2xl shadow-sky-500/40 ring-4 ring-white/20 backdrop-blur-md transition duration-200 hover:scale-110 hover:bg-sky-400 active:scale-95"
          aria-label="Play video"
        >
          <Play size={34} fill="currentColor" className="ml-1" />
        </button>
      )}

      {/* Autoplay blocked sound notice */}
      {autoplayBlockedSound && (
        <button
          type="button"
          onClick={toggleMute}
          className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full bg-amber-500/90 px-3.5 py-1.5 text-xs font-semibold text-black shadow-lg backdrop-blur-md transition hover:bg-amber-400 animate-bounce"
        >
          <VolumeX size={15} />
          <span>Muted by browser — Click to unmute</span>
        </button>
      )}

      {/* Top badges (Type / Source / Quality) */}
      <div className="pointer-events-none absolute top-3 right-3 z-10 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white">
        {isGif ? (
          <span className="flex items-center gap-1 rounded-md bg-purple-500/80 px-2 py-0.5 backdrop-blur-md">
            <Sparkles size={11} /> GIF
          </span>
        ) : (
          <>
            <span className="rounded-md bg-black/60 px-2 py-0.5 backdrop-blur-md ring-1 ring-white/10">
              {sourceType === "hls" ? "HLS Stream" : sourceType === "proxy" ? "Proxy Stream" : "Direct MP4"}
            </span>
            {activeQuality !== "auto" && (
              <span className="rounded-md bg-sky-500/80 px-2 py-0.5 backdrop-blur-md">{activeQuality}</span>
            )}
          </>
        )}
      </div>

      {/* Custom Control Bar */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/95 via-black/60 to-transparent p-4 transition-opacity duration-300 ${
          showControls || !isPlaying ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Timeline Seeker */}
        <div
          className="group/seek relative mb-3 flex h-3 w-full cursor-pointer items-center"
          onClick={onSeek}
        >
          <div className="h-1.5 w-full rounded-full bg-white/20 transition-all group-hover/seek:h-2.5">
            {/* Buffered bar */}
            <div
              className="h-full rounded-full bg-white/30"
              style={{ width: `${bufferPercent}%` }}
            />
            {/* Progress bar */}
            <div
              className="absolute top-0 h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500"
              style={{ width: `${progressPercent}%` }}
            >
              {/* Scrub handle */}
              <div className="absolute right-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-white shadow-md transition-transform scale-0 group-hover/seek:scale-100" />
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-3 text-white">
          {/* Left: Play/Pause, Rewind, Volume, Time */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
            </button>

            {!isGif && (
              <button
                type="button"
                onClick={() => skipSeconds(-10)}
                className="hidden h-9 w-9 items-center justify-center rounded-lg bg-white/5 text-neutral-300 transition hover:bg-white/15 sm:flex"
                title="Rewind 10 seconds"
              >
                <RotateCcw size={16} />
              </button>
            )}

            {/* Volume control */}
            <div className="group/vol flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20"
                aria-label={isMuted ? "Unmute" : "Mute"}
              >
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="h-1.5 w-0 cursor-pointer accent-sky-400 transition-all duration-200 group-hover/vol:w-16 sm:w-14"
                title="Volume"
              />
            </div>

            {/* Time readout */}
            <div className="text-xs font-medium text-neutral-300">
              <span>{formatTime(currentTime)}</span>
              <span className="text-neutral-500"> / </span>
              <span className="text-neutral-400">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Right: Settings, Speed, Loop, Fullscreen */}
          <div className="relative flex items-center gap-1 sm:gap-2">
            {/* Speed quick toggle */}
            <button
              type="button"
              onClick={() => {
                const speeds = [1, 1.25, 1.5, 2, 0.75];
                const nextIdx = (speeds.indexOf(playbackRate) + 1) % speeds.length;
                changeSpeed(speeds[nextIdx]);
              }}
              className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-neutral-200 transition hover:bg-white/20"
              title="Change speed"
            >
              {playbackRate}x
            </button>

            {/* Settings menu (Quality & Speed) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-white transition ${
                  showSettings ? "bg-sky-500" : "bg-white/10 hover:bg-white/20"
                }`}
                title="Settings & Quality"
              >
                <Settings size={17} />
              </button>

              {showSettings && (
                <div className="absolute bottom-11 right-0 w-48 rounded-xl border border-white/15 bg-neutral-900/95 p-2 shadow-2xl backdrop-blur-xl z-50">
                  <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                    Quality
                  </div>
                  <button
                    type="button"
                    onClick={() => selectQuality("auto")}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
                  >
                    <span>Auto (Best)</span>
                    {activeQuality === "auto" && <Check size={14} className="text-sky-400" />}
                  </button>
                  {mp4Variants.map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => selectQuality(v)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
                    >
                      <span>{v.label}</span>
                      {activeQuality === v.label && <Check size={14} className="text-sky-400" />}
                    </button>
                  ))}

                  <div className="my-1.5 border-t border-white/10" />
                  <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                    Loop
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLooping(!isLooping)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-neutral-200 transition hover:bg-white/10"
                  >
                    <span>Repeat video</span>
                    {isLooping && <Check size={14} className="text-sky-400" />}
                  </button>
                </div>
              )}
            </div>

            {/* Fullscreen */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
              aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
