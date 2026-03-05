"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface AudioWaveformProps {
  audioUrl: string;
  isPlaying: boolean;
  audioDuration: number;
  audioElement?: HTMLAudioElement | null;
  onSeek?: (time: number) => void;
  height?: number;
}

// Cache decoded waveform data by URL (LRU, max 100 entries)
const WAVEFORM_CACHE_MAX = 100;
const waveformCache = new Map<string, Float32Array>();

function waveformCacheSet(key: string, value: Float32Array) {
  if (waveformCache.size >= WAVEFORM_CACHE_MAX) {
    // Delete oldest entry (first key in insertion order)
    const oldest = waveformCache.keys().next().value;
    if (oldest !== undefined) waveformCache.delete(oldest);
  }
  waveformCache.set(key, value);
}

export function AudioWaveform({
  audioUrl,
  isPlaying,
  audioDuration,
  audioElement,
  onSeek,
  height = 48,
}: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);

  // Downsample audio buffer to ~150 bars
  const downsample = useCallback((buffer: AudioBuffer, targetBars: number): Float32Array => {
    const rawData = buffer.getChannelData(0);
    const blockSize = Math.floor(rawData.length / targetBars);
    const bars = new Float32Array(targetBars);

    for (let i = 0; i < targetBars; i++) {
      let sum = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[start + j]);
      }
      bars[i] = sum / blockSize;
    }
    return bars;
  }, []);

  // Fetch and decode audio
  useEffect(() => {
    if (!audioUrl) return;

    // Check cache first
    const cached = waveformCache.get(audioUrl);
    if (cached) {
      setWaveformData(cached);
      setLoading(false);
      return;
    }

    const abortController = new AbortController();
    let cancelled = false;
    setLoading(true);

    (async () => {
      let audioContext: AudioContext | null = null;
      try {
        const response = await fetch(audioUrl, { signal: abortController.signal });
        const arrayBuffer = await response.arrayBuffer();
        audioContext = new AudioContext();
        // Bug #167: resume if suspended (e.g., due to browser autoplay policy)
        if (audioContext.state === "suspended") await audioContext.resume();
        const decoded = await audioContext.decodeAudioData(arrayBuffer);

        if (cancelled) return;

        const bars = downsample(decoded, 150);
        waveformCacheSet(audioUrl, bars);
        setWaveformData(bars);
      } catch {
        // silent — waveform just won't show (includes AbortError)
      } finally {
        audioContext?.close().catch(() => {});
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [audioUrl, downsample]);

  // Track playback progress
  useEffect(() => {
    if (!isPlaying || !audioElement) {
      cancelAnimationFrame(animFrameRef.current);
      if (audioElement && audioElement.duration > 0) {
        setProgress(audioElement.currentTime / audioElement.duration);
      }
      return;
    }

    const tick = () => {
      if (audioElement.duration > 0) {
        setProgress(audioElement.currentTime / audioElement.duration);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, audioElement]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !waveformData) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const totalBars = waveformData.length;
    const barWidth = width / totalBars;

    // Find peak for normalization
    let peak = 0;
    for (let i = 0; i < totalBars; i++) {
      peak = Math.max(peak, waveformData[i]);
    }
    const normFactor = peak > 0 ? 1 / peak : 1;

    const progressBar = Math.floor(progress * totalBars);

    for (let i = 0; i < totalBars; i++) {
      const amplitude = waveformData[i] * normFactor;
      const barHeight = Math.max(1, amplitude * height * 0.9);
      const x = i * barWidth;
      const y = height - barHeight;

      if (i < progressBar) {
        ctx.fillStyle = "rgba(34, 197, 94, 0.8)"; // green — played
      } else {
        ctx.fillStyle = "rgba(148, 163, 184, 0.4)"; // slate — unplayed
      }

      ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), barHeight);
    }
  }, [waveformData, progress, height, resizeTick]);

  // Bug #138: ResizeObserver to redraw canvas on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setResizeTick((c) => c + 1);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Handle click to seek
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onSeek || !canvasRef.current || !audioDuration) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clampedRatio = Math.max(0, Math.min(1, ratio));
      onSeek(clampedRatio * audioDuration);
    },
    [onSeek, audioDuration]
  );

  if (loading) {
    return (
      <div
        className="w-full rounded bg-muted/50 animate-pulse"
        style={{ height }}
      />
    );
  }

  if (!waveformData) return null;

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        className="w-full rounded cursor-pointer"
        style={{ height }}
        onClick={handleClick}
      />
    </div>
  );
}
