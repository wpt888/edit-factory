export type ExploreMediaKind = "image" | "video";
export type ExploreMediaOrientation = "landscape" | "portrait" | "square";

export interface ExploreMediaAsset {
  id: string;
  kind: ExploreMediaKind;
  title: string;
  width: number;
  height: number;
  orientation: ExploreMediaOrientation;
  ratioLabel: string;
  imageUrl?: string;
  videoUrl?: string;
  posterUrl?: string;
  sourceName: "Wikimedia Commons";
  sourceUrl: string;
  attribution: string;
  licenseName: string;
  licenseUrl?: string;
  aiEvidenceUrl: string;
  commonsFileTitle: string;
}

interface WikimediaMetadataValue {
  value?: string;
}

interface WikimediaImageInfo {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  duration?: number;
  size?: number;
  mime?: string;
  mediatype?: string;
  descriptionurl?: string;
  extmetadata?: Record<string, WikimediaMetadataValue>;
}

interface WikimediaDerivative {
  src?: string;
  type?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  transcodekey?: string;
}

interface WikimediaVideoInfo extends WikimediaImageInfo {
  derivatives?: WikimediaDerivative[];
}

interface WikimediaPage {
  pageid?: number;
  title?: string;
  imageinfo?: WikimediaImageInfo[];
  videoinfo?: WikimediaVideoInfo[];
}

interface WikimediaResponse {
  continue?: {
    gsroffset?: number;
  };
  query?: {
    pages?: WikimediaPage[];
  };
}

const WIKIMEDIA_API_URL = "https://commons.wikimedia.org/w/api.php";
const AI_EVIDENCE_CATEGORY: Record<ExploreMediaKind, string> = {
  image: "AI-generated images by subject",
  video: "AI-generated videos",
};
const SAFE_AI_IMAGE_CATEGORIES = [
  "AI-generated images of animals",
  "AI-generated images of architecture",
  "AI-generated images of food",
  "AI-generated images of nature",
  "AI-generated images of objects",
  "AI-generated images of geometric shapes",
  "AI-generated aliens",
  "AI-generated images of dystopias",
] as const;

const AI_SEARCH_QUERIES: Record<ExploreMediaKind, string[]> = {
  image: SAFE_AI_IMAGE_CATEGORIES
    .map((category) => `deepcat:"${category}"`),
  video: ['deepcat:"AI-generated videos"'],
};

export const AI_MEDIA_TARGETS: Record<ExploreMediaKind, number> = {
  image: 130,
  video: 30,
};

const SEARCH_PAGE_LIMIT = 50;
const MAX_SEARCH_PAGES_PER_QUERY = 6;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_DURATION_SECONDS = 90;
const API_REQUEST_GAP_MS = 220;
const CATALOG_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CATALOG_CACHE_VERSION = 3;

const catalogCache = new Map<ExploreMediaKind, ExploreMediaAsset[]>();
let unifiedCatalogCache: ExploreMediaAsset[] | null = null;
let nextApiRequestAt = 0;

const HIGH_RISK_MARKERS = [
  "ai-generated media of living people",
  "ai-generated videos of real people",
  "celebrity",
  "copyrighted character",
  "deepfake",
  "fan art",
  "fictional character",
  "living people",
  "logo",
  "religion",
  "people",
  "political",
  "politician",
  "portraits of",
  "public figures",
  "trademark",
];

const HIGH_RISK_TITLE_MARKERS = [
  "batman",
  "biden",
  "cybertruck",
  "coca-cola",
  "donald trump",
  "elon musk",
  "harry potter",
  "j.d. vance",
  "kim jong",
  "lego",
  "mario",
  "marvel",
  "mickey",
  "pink floyd",
  "putin",
  "religion",
  "rhinoceros wearing",
  "star wars",
  "superman",
  "súper bigote",
  "taylor swift",
  "tesla",
  "will smith",
];

const SHOWCASE_EXCLUSION_MARKERS = [
  "approximation of",
  "chart",
  "coat of arms",
  "demonstration of",
  "diagram",
  "distribution",
  "equation",
  "flag",
  "graph",
  "infographic",
  "in style of",
  "logo",
  "map of",
  "scheem",
  "schema",
  "screenshot",
  "style by",
  "style of",
  "table of",
  "visual selection",
  "wikimedia",
  "wikipedia",
  "workflow",
];

function orientationFor(width: number, height: number): ExploreMediaOrientation {
  const ratio = width / height;
  if (ratio > 1.08) return "landscape";
  if (ratio < 0.92) return "portrait";
  return "square";
}

function ratioLabelFor(width: number, height: number): string {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.08) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(ratio - 3 / 2) < 0.05) return "3:2";
  if (Math.abs(ratio - 2 / 3) < 0.05) return "2:3";
  if (Math.abs(ratio - 4 / 3) < 0.05) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.05) return "3:4";
  if (Math.abs(ratio - 4 / 5) < 0.05) return "4:5";
  if (Math.abs(ratio - 1) < 0.08) return "1:1";
  return orientationFor(width, height) === "portrait" ? "Portrait" : "Landscape";
}

function plainText(value?: string): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromFilename(filename?: string): string {
  return (filename ?? "AI-generated media")
    .replace(/^File:/i, "")
    .replace(/\.[^.]+$/, "")
    .replace(/_/g, " ")
    .trim();
}

function isReusableLicense(licenseName: string): boolean {
  const license = licenseName.toLowerCase();
  if (!license) return false;
  return (
    license.includes("public domain") ||
    license === "cc0" ||
    license.includes("cc zero")
  );
}

function hasHighRiskRightsMarkers(title: string, categories: string): boolean {
  const normalizedTitle = title.toLowerCase();
  const normalizedCategories = categories.toLowerCase();
  return (
    HIGH_RISK_MARKERS.some((marker) => normalizedCategories.includes(marker)) ||
    HIGH_RISK_TITLE_MARKERS.some((marker) => normalizedTitle.includes(marker)) ||
    SHOWCASE_EXCLUSION_MARKERS.some((marker) => normalizedTitle.includes(marker))
  );
}

function stableRank(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function waitWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function fetchWikimediaJson(
  url: string,
  signal?: AbortSignal,
): Promise<WikimediaResponse> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextApiRequestAt);
    nextApiRequestAt = scheduledAt + API_REQUEST_GAP_MS;
    await waitWithAbort(scheduledAt - now, signal);

    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (response.ok) return response.json() as Promise<WikimediaResponse>;
    if ((response.status === 429 || response.status === 503) && attempt < 3) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? "");
      const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 10_000)
        : 750 * (attempt + 1);
      await waitWithAbort(retryDelay, signal);
      continue;
    }
    throw new Error(`Wikimedia Commons catalog returned ${response.status}.`);
  }
  throw new Error("Wikimedia Commons catalog is temporarily unavailable.");
}

function persistentCacheKey(kind: ExploreMediaKind): string {
  return `blipost.ai-media-catalog.${CATALOG_CACHE_VERSION}.${kind}`;
}

function readPersistentCatalog(kind: ExploreMediaKind): ExploreMediaAsset[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = JSON.parse(localStorage.getItem(persistentCacheKey(kind)) ?? "null") as {
      savedAt?: number;
      assets?: ExploreMediaAsset[];
    } | null;
    if (
      !stored?.savedAt ||
      Date.now() - stored.savedAt > CATALOG_CACHE_TTL_MS ||
      !Array.isArray(stored.assets)
    ) {
      return null;
    }
    const verified = stored.assets.filter(
      (asset) =>
        asset.kind === kind &&
        asset.sourceName === "Wikimedia Commons" &&
        isReusableLicense(asset.licenseName) &&
        asset.aiEvidenceUrl?.includes("commons.wikimedia.org/wiki/Category:"),
    );
    return verified.length >= AI_MEDIA_TARGETS[kind]
      ? verified.slice(0, AI_MEDIA_TARGETS[kind])
      : null;
  } catch {
    return null;
  }
}

function storePersistentCatalog(
  kind: ExploreMediaKind,
  assets: ExploreMediaAsset[],
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      persistentCacheKey(kind),
      JSON.stringify({ savedAt: Date.now(), assets }),
    );
  } catch {
    // A private or storage-constrained browser still keeps the in-memory cache.
  }
}

function pageToAsset(
  page: WikimediaPage,
  kind: ExploreMediaKind,
): ExploreMediaAsset | null {
  const info = page.imageinfo?.[0];
  const width = info?.width ?? 0;
  const height = info?.height ?? 0;
  const mime = info?.mime?.toLowerCase() ?? "";
  const metadata = info?.extmetadata ?? {};
  const title = titleFromFilename(page.title);
  const categories = metadata.Categories?.value ?? "";
  const licenseName = plainText(
    metadata.LicenseShortName?.value ?? metadata.UsageTerms?.value,
  );

  if (
    width <= 0 ||
    height <= 0 ||
    !info?.url ||
    !info.descriptionurl ||
    !isReusableLicense(licenseName) ||
    hasHighRiskRightsMarkers(title, categories)
  ) {
    return null;
  }

  if (kind === "image" && (!mime.startsWith("image/") || !info.thumburl)) return null;
  if (
    kind === "video" &&
    (
      mime !== "video/webm" ||
      !info.thumburl ||
      !info.duration ||
      info.duration > MAX_VIDEO_DURATION_SECONDS ||
      (info.size ?? Number.POSITIVE_INFINITY) > MAX_VIDEO_BYTES
    )
  ) {
    return null;
  }

  const attribution =
    plainText(metadata.Artist?.value) ||
    plainText(metadata.Credit?.value) ||
    "Wikimedia Commons contributor";
  const licenseUrl = metadata.LicenseUrl?.value;
  const categoryName = AI_EVIDENCE_CATEGORY[kind];

  return {
    id: `commons-${kind}-${page.pageid ?? stableRank(page.title ?? title)}`,
    kind,
    title,
    width,
    height,
    orientation: orientationFor(width, height),
    ratioLabel: ratioLabelFor(width, height),
    imageUrl: kind === "image" ? info.thumburl : undefined,
    videoUrl: kind === "video" ? info.url : undefined,
    posterUrl: kind === "video" ? info.thumburl : undefined,
    sourceName: "Wikimedia Commons",
    sourceUrl: info.descriptionurl,
    attribution,
    licenseName,
    licenseUrl,
    aiEvidenceUrl: `https://commons.wikimedia.org/wiki/Category:${encodeURIComponent(
      categoryName.replaceAll(" ", "_"),
    )}`,
    commonsFileTitle: page.title ?? `File:${title}`,
  };
}

function buildSearchUrl(
  kind: ExploreMediaKind,
  searchQuery: string,
  offset?: number,
): string {
  const parameters = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "search",
    gsrsearch: searchQuery,
    gsrnamespace: "6",
    gsrlimit: String(SEARCH_PAGE_LIMIT),
    prop: "imageinfo",
    iiprop: "url|size|mime|mediatype|extmetadata",
    iiextmetadatafilter:
      "Categories|Artist|Credit|LicenseShortName|UsageTerms|LicenseUrl|AttributionRequired",
    iiurlwidth: "640",
    maxlag: "5",
  });
  if (offset !== undefined) parameters.set("gsroffset", String(offset));
  return `${WIKIMEDIA_API_URL}?${parameters.toString()}`;
}

async function fetchSearchPage(
  kind: ExploreMediaKind,
  searchQuery: string,
  signal?: AbortSignal,
  offset?: number,
): Promise<WikimediaResponse> {
  return fetchWikimediaJson(buildSearchUrl(kind, searchQuery, offset), signal);
}

function preferredVideoDerivative(
  derivatives: WikimediaDerivative[] = [],
): WikimediaDerivative | undefined {
  const playable = derivatives.filter(
    (derivative) =>
      derivative.src?.startsWith("https://") &&
      derivative.type?.toLowerCase().includes("video/webm") &&
      derivative.transcodekey,
  );
  return (
    playable.find((derivative) => derivative.transcodekey?.includes("480p")) ??
    playable.find((derivative) => derivative.transcodekey?.includes("360p")) ??
    playable.find((derivative) => derivative.transcodekey?.includes("240p")) ??
    playable.sort(
      (left, right) => (left.bandwidth ?? Number.POSITIVE_INFINITY) -
        (right.bandwidth ?? Number.POSITIVE_INFINITY),
    )[0]
  );
}

async function attachVideoDerivatives(
  assets: ExploreMediaAsset[],
  signal?: AbortSignal,
): Promise<ExploreMediaAsset[]> {
  const enhanced: ExploreMediaAsset[] = [];

  for (let index = 0; index < assets.length; index += 50) {
    const batch = assets.slice(index, index + 50);
    const parameters = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      titles: batch.map((asset) => asset.commonsFileTitle).join("|"),
      prop: "videoinfo",
      viprop: "url|size|mime|mediatype|derivatives",
      viurlwidth: "640",
      maxlag: "5",
    });
    const data = await fetchWikimediaJson(
      `${WIKIMEDIA_API_URL}?${parameters.toString()}`,
      signal,
    );
    const infoByTitle = new Map(
      (data.query?.pages ?? []).map((page) => [page.title, page.videoinfo?.[0]]),
    );

    for (const asset of batch) {
      const videoInfo = infoByTitle.get(asset.commonsFileTitle);
      const derivative = preferredVideoDerivative(videoInfo?.derivatives);
      if (!derivative?.src) continue;
      enhanced.push({
        ...asset,
        videoUrl: derivative.src,
        posterUrl: videoInfo?.thumburl ?? asset.posterUrl,
      });
    }
  }

  return enhanced;
}

export async function loadAiMediaCatalog(
  kind: ExploreMediaKind,
  signal?: AbortSignal,
): Promise<ExploreMediaAsset[]> {
  const cached = catalogCache.get(kind);
  if (cached) return cached;
  const persistent = readPersistentCatalog(kind);
  if (persistent) {
    catalogCache.set(kind, persistent);
    return persistent;
  }

  const target = AI_MEDIA_TARGETS[kind];
  const candidateTarget = kind === "video" ? target + 20 : target;
  const assets = new Map<string, ExploreMediaAsset>();
  const searchQueries = AI_SEARCH_QUERIES[kind];
  const offsets = new Map<string, number>();
  const exhaustedQueries = new Set<string>();

  for (
    let pageIndex = 0;
    pageIndex < MAX_SEARCH_PAGES_PER_QUERY;
    pageIndex += 1
  ) {
    for (const searchQuery of searchQueries) {
      if (exhaustedQueries.has(searchQuery)) continue;
      const response = await fetchSearchPage(
        kind,
        searchQuery,
        signal,
        offsets.get(searchQuery),
      );
      for (const page of response.query?.pages ?? []) {
        const asset = pageToAsset(page, kind);
        if (asset) assets.set(asset.id, asset);
      }
      if (response.continue?.gsroffset === undefined) {
        exhaustedQueries.add(searchQuery);
      } else {
        offsets.set(searchQuery, response.continue.gsroffset);
      }
    }
    if (assets.size >= candidateTarget) break;
    if (exhaustedQueries.size === searchQueries.length) break;
  }

  const sortedAssets = [...assets.values()]
    .sort((left, right) => stableRank(left.id) - stableRank(right.id));
  const verifiedAssets = (
    kind === "video"
      ? await attachVideoDerivatives(sortedAssets, signal)
      : sortedAssets
  ).slice(0, target);

  if (verifiedAssets.length === 0) {
    throw new Error("No rights-verified AI media is currently available.");
  }

  catalogCache.set(kind, verifiedAssets);
  storePersistentCatalog(kind, verifiedAssets);
  return verifiedAssets;
}

function interleaveMediaCatalogs(
  images: ExploreMediaAsset[],
  videos: ExploreMediaAsset[],
): ExploreMediaAsset[] {
  const unified: ExploreMediaAsset[] = [];
  let imageIndex = 0;
  let videoIndex = 0;

  while (imageIndex < images.length || videoIndex < videos.length) {
    for (
      let batchIndex = 0;
      batchIndex < 4 && imageIndex < images.length;
      batchIndex += 1
    ) {
      unified.push(images[imageIndex]);
      imageIndex += 1;
    }
    if (videoIndex < videos.length) {
      unified.push(videos[videoIndex]);
      videoIndex += 1;
    }
  }

  return unified;
}

export async function loadUnifiedAiMediaCatalog(
  signal?: AbortSignal,
): Promise<ExploreMediaAsset[]> {
  if (unifiedCatalogCache) return unifiedCatalogCache;

  const [images, videos] = await Promise.all([
    loadAiMediaCatalog("image", signal),
    loadAiMediaCatalog("video", signal),
  ]);
  const unified = interleaveMediaCatalogs(images, videos);
  if (signal?.aborted) {
    throw new DOMException("Request aborted", "AbortError");
  }
  unifiedCatalogCache = unified;
  return unified;
}
