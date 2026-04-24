// Shared platform metadata used by Pipeline Step 4 (PublishDialog) and Settings
// (Connected Social Platforms panel). Keep this in one place so the two UIs
// don't drift — e.g. "instagram-standalone" must map to "Instagram" in both.

export const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  twitter: 280,
  bluesky: 300,
  threads: 500,
  instagram: 2200,
  "instagram-standalone": 2200,
  youtube: 5000,
  linkedin: 3000,
  "linkedin-page": 3000,
  facebook: 63206,
  tiktok: 150,
}

export const PLATFORM_NAMES: Record<string, string> = {
  x: "X",
  twitter: "X",
  bluesky: "Bluesky",
  threads: "Threads",
  instagram: "Instagram",
  "instagram-standalone": "Instagram",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  "linkedin-page": "LinkedIn Page",
  facebook: "Facebook",
  tiktok: "TikTok",
}

export function friendlyPlatformName(type: string): string {
  return PLATFORM_NAMES[type?.toLowerCase?.() ?? ""] ?? type
}
