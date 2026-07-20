"use client";

export type SafeZoneType = "post" | "story" | "reel";

const SAFE_ZONES: Record<SafeZoneType, {
  label: string;
  top: number;
  right: number;
  bottom: number;
  left: number;
}> = {
  // A 4:5 feed crop centered inside the 9:16 working canvas.
  post: { label: "Post 4:5", top: 14.85, right: 5, bottom: 14.85, left: 5 },
  // Keep interactive Story UI clear at the top and bottom.
  story: { label: "Story", top: 12.5, right: 5.5, bottom: 12.5, left: 5.5 },
  // Reels reserve extra room for the action rail and caption controls.
  reel: { label: "Reel", top: 8, right: 12, bottom: 20, left: 5.5 },
};

export function SafeZoneOverlay({ type }: { type: SafeZoneType }) {
  const zone = SAFE_ZONES[type];
  const shade = "rgba(239, 68, 68, 0.14)";

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40"
      data-testid="safe-zone-overlay"
      data-safe-zone={type}
    >
      <div className="absolute inset-x-0 top-0" style={{ height: `${zone.top}%`, background: shade }} />
      <div className="absolute inset-x-0 bottom-0" style={{ height: `${zone.bottom}%`, background: shade }} />
      <div
        className="absolute left-0"
        style={{ top: `${zone.top}%`, bottom: `${zone.bottom}%`, width: `${zone.left}%`, background: shade }}
      />
      <div
        className="absolute right-0"
        style={{ top: `${zone.top}%`, bottom: `${zone.bottom}%`, width: `${zone.right}%`, background: shade }}
      />
      <div
        className="absolute border border-dashed border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
        style={{ top: `${zone.top}%`, right: `${zone.right}%`, bottom: `${zone.bottom}%`, left: `${zone.left}%` }}
      >
        <span className="absolute left-1 top-1 rounded bg-black/65 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white">
          {zone.label} safe zone
        </span>
      </div>
    </div>
  );
}
