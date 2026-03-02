"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface LogoDragOverlayProps {
  imageUrl: string;
  logoUrl: string;
  imageWidth: number;
  imageHeight: number;
  onPositionChange: (x: number, y: number, scale: number) => void;
  initialX?: number;
  initialY?: number;
  initialScale?: number;
}

export function LogoDragOverlay({
  imageUrl,
  logoUrl,
  imageWidth,
  imageHeight,
  onPositionChange,
  initialX = 20,
  initialY = 20,
  initialScale = 0.3,
}: LogoDragOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(initialScale);
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const dragOffset = useRef({ x: 0, y: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });

  // Track container display dimensions for coordinate mapping
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDisplaySize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Convert display coordinates to real image coordinates
  const toReal = useCallback(
    (displayX: number, displayY: number) => {
      if (!displaySize.width || !displaySize.height) return { x: 0, y: 0 };
      const ratioX = imageWidth / displaySize.width;
      const ratioY = imageHeight / displaySize.height;
      return {
        x: Math.round(displayX * ratioX),
        y: Math.round(displayY * ratioY),
      };
    },
    [imageWidth, imageHeight, displaySize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragOffset.current = {
        x: e.clientX - rect.left - position.x,
        y: e.clientY - rect.top - position.y,
      };
      setDragging(true);
    },
    [position]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newX = Math.max(0, e.clientX - rect.left - dragOffset.current.x);
      const newY = Math.max(0, e.clientY - rect.top - dragOffset.current.y);

      // Clamp to container bounds
      const logoEl = logoRef.current;
      const maxX = logoEl ? rect.width - logoEl.offsetWidth : rect.width;
      const maxY = logoEl ? rect.height - logoEl.offsetHeight : rect.height;

      const clampedX = Math.min(newX, Math.max(0, maxX));
      const clampedY = Math.min(newY, Math.max(0, maxY));

      setPosition({ x: clampedX, y: clampedY });
    },
    [dragging]
  );

  const handleMouseUp = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    const real = toReal(position.x, position.y);
    onPositionChange(real.x, real.y, scale);
  }, [dragging, position, scale, toReal, onPositionChange]);

  const handleScaleChange = useCallback(
    (value: number[]) => {
      const newScale = value[0];
      setScale(newScale);
      const real = toReal(position.x, position.y);
      onPositionChange(real.x, real.y, newScale);
    },
    [position, toReal, onPositionChange]
  );

  // Logo display size based on scale and container ratio
  const logoDisplayScale = displaySize.width ? (displaySize.width / imageWidth) * scale : scale;

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-border cursor-crosshair select-none"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Base image */}
        <img
          src={imageUrl}
          alt="Generated"
          className="w-full h-auto block"
          draggable={false}
        />

        {/* Draggable logo */}
        <img
          ref={logoRef}
          src={logoUrl}
          alt="Logo"
          draggable={false}
          className={`absolute pointer-events-auto ${dragging ? "opacity-80" : "opacity-100"} transition-opacity`}
          style={{
            left: position.x,
            top: position.y,
            transform: `scale(${logoDisplayScale})`,
            transformOrigin: "top left",
            cursor: dragging ? "grabbing" : "grab",
          }}
          onMouseDown={handleMouseDown}
        />
      </div>

      {/* Scale slider */}
      <div className="flex items-center gap-4">
        <Label className="text-sm whitespace-nowrap w-24">Logo Scale</Label>
        <Slider
          value={[scale]}
          onValueChange={handleScaleChange}
          min={0.1}
          max={2.0}
          step={0.05}
          className="flex-1"
        />
        <span className="text-sm text-muted-foreground w-12 text-right">
          {scale.toFixed(2)}x
        </span>
      </div>
    </div>
  );
}
