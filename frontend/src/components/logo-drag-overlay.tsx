"use client";

import React, { useRef, useState, useCallback, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
  const [dragging, setDragging] = useState(false);
  const [scale, setScale] = useState(initialScale);
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const dragOffset = useRef({ x: 0, y: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [logoNatural, setLogoNatural] = useState({ width: 0, height: 0 });

  // Refs for values used in drag-end effect to avoid stale closures
  const positionRef = useRef(position);
  const scaleRef = useRef(scale);
  const toRealRef = useRef<(x: number, y: number) => { x: number; y: number }>(() => ({ x: 0, y: 0 }));
  const onPositionChangeRef = useRef(onPositionChange);
  useEffect(() => { positionRef.current = position; }, [position]);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { onPositionChangeRef.current = onPositionChange; }, [onPositionChange]);

  // Sync state when parent provides new initial values
  useEffect(() => { setPosition({ x: initialX, y: initialY }); }, [initialX, initialY]);
  useEffect(() => { setScale(initialScale); }, [initialScale]);

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
  useEffect(() => { toRealRef.current = toReal; }, [toReal]);

  // Compute the visual (display) size of the logo
  const displayRatio = displaySize.width ? displaySize.width / imageWidth : 1;
  const logoDisplayW = logoNatural.width ? logoNatural.width * scale * displayRatio : 0;
  const logoDisplayH = logoNatural.height ? logoNatural.height * scale * displayRatio : 0;

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

  // Use window-level mousemove/mouseup so dragging doesn't break when cursor leaves the element
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newX = e.clientX - rect.left - dragOffset.current.x;
      const newY = e.clientY - rect.top - dragOffset.current.y;

      // Clamp using the actual visual logo dimensions
      const maxX = Math.max(0, rect.width - logoDisplayW);
      const maxY = Math.max(0, rect.height - logoDisplayH);

      const clampedX = Math.max(0, Math.min(newX, maxX));
      const clampedY = Math.max(0, Math.min(newY, maxY));

      setPosition({ x: clampedX, y: clampedY });
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, logoDisplayW, logoDisplayH]);

  // Notify parent when dragging ends
  useEffect(() => {
    if (!dragging && positionRef.current.x !== initialX && positionRef.current.y !== initialY) {
      const real = toRealRef.current(positionRef.current.x, positionRef.current.y);
      onPositionChangeRef.current(real.x, real.y, scaleRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  const handleScaleChange = useCallback(
    (value: number[]) => {
      const newScale = value[0];
      setScale(newScale);
      const real = toReal(position.x, position.y);
      onPositionChange(real.x, real.y, newScale);
    },
    [position, toReal, onPositionChange]
  );

  // Quick-position presets (in real image coordinates, accounting for actual logo size)
  const scaledLogoW = logoNatural.width * scale;
  const scaledLogoH = logoNatural.height * scale;

  const quickPositions = [
    { label: "TL", x: 20, y: 20 },
    { label: "TR", x: Math.max(20, imageWidth - scaledLogoW - 20), y: 20 },
    { label: "BL", x: 20, y: Math.max(20, imageHeight - scaledLogoH - 20) },
    { label: "BR", x: Math.max(20, imageWidth - scaledLogoW - 20), y: Math.max(20, imageHeight - scaledLogoH - 20) },
    { label: "Center", x: Math.round((imageWidth - scaledLogoW) / 2), y: Math.round((imageHeight - scaledLogoH) / 2) },
  ];

  const applyQuickPosition = useCallback(
    (realX: number, realY: number) => {
      if (!displaySize.width || !displaySize.height) return;
      const ratioX = displaySize.width / imageWidth;
      const ratioY = displaySize.height / imageHeight;
      const displayX = Math.round(realX * ratioX);
      const displayY = Math.round(realY * ratioY);
      setPosition({ x: displayX, y: displayY });
      onPositionChange(realX, realY, scale);
    },
    [displaySize, imageWidth, imageHeight, scale, onPositionChange]
  );

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border border-border cursor-crosshair select-none"
      >
        {/* Base image */}
        <img
          src={imageUrl}
          alt="Generated"
          className="w-full h-auto block"
          draggable={false}
        />

        {/* Draggable logo — uses explicit width/height so layout matches visual size */}
        {logoDisplayW > 0 && logoDisplayH > 0 && (
          <img
            src={logoUrl}
            alt="Logo"
            draggable={false}
            className={`absolute pointer-events-auto ${dragging ? "opacity-80" : "opacity-100"} transition-opacity`}
            style={{
              left: position.x,
              top: position.y,
              width: logoDisplayW,
              height: logoDisplayH,
              cursor: dragging ? "grabbing" : "grab",
            }}
            onMouseDown={handleMouseDown}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setLogoNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
          />
        )}

        {/* Hidden loader to get natural dimensions before first render */}
        {logoNatural.width === 0 && (
          <img
            src={logoUrl}
            alt=""
            className="absolute opacity-0 pointer-events-none"
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setLogoNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }
            }}
          />
        )}
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

      {/* Quick-position buttons */}
      <div className="flex items-center gap-2">
        <Label className="text-sm whitespace-nowrap w-24">Quick Position</Label>
        <div className="flex gap-1.5 flex-wrap">
          {quickPositions.map((qp) => (
            <Button
              key={qp.label}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => applyQuickPosition(qp.x, qp.y)}
            >
              {qp.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
