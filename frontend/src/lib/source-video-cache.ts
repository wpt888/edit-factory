/**
 * Session-scoped source-video cache.
 *
 * Pipeline is unmounted while the user edits segments, so component state alone
 * cannot retain the already fetched source-video list. Keeping it at module
 * scope retains it for the lifetime of the desktop renderer without writing
 * data to disk. Entries are keyed by profile to avoid showing another
 * profile's library after a profile switch.
 */
type CacheEntry = {
  videos?: unknown;
  pending?: Promise<unknown>;
};

const sourceVideoCache = new Map<string, CacheEntry>();

export async function getCachedSourceVideos<T>(
  profileId: string,
  load: () => Promise<T>,
): Promise<T> {
  const entry = sourceVideoCache.get(profileId);
  if (entry?.videos) return entry.videos as T;
  if (entry?.pending) return entry.pending as Promise<T>;

  const pending = load()
    .then((videos) => {
      sourceVideoCache.set(profileId, { videos });
      return videos;
    })
    .catch((error) => {
      sourceVideoCache.delete(profileId);
      throw error;
    });

  sourceVideoCache.set(profileId, { pending });
  return pending;
}

export function invalidateCachedSourceVideos(profileId?: string) {
  if (profileId) {
    sourceVideoCache.delete(profileId);
    return;
  }
  sourceVideoCache.clear();
}
