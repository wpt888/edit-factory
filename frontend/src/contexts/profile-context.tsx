/**
 * Profile Context - Client-side profile state management with localStorage persistence
 *
 * This context provides:
 * - currentProfile: Currently selected profile
 * - profiles: All available profiles for the user
 * - setCurrentProfile: Function to switch profiles
 * - refreshProfiles: Function to refetch profiles from API
 * - isLoading: Loading state during initialization
 *
 * Pattern: React Context + localStorage hybrid
 * - localStorage provides persistence across sessions
 * - React Context provides reactivity and state sharing
 * - Hydration strategy: localStorage first (instant UI) → API fetch (fresh data)
 */

"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import { apiGet } from "@/lib/api";

// Profile interface matching backend schema
interface Profile {
  id: string;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
}

interface ProfileContextType {
  currentProfile: Profile | null;
  profiles: Profile[];
  setCurrentProfile: (profile: Profile) => void;
  refreshProfiles: () => Promise<void>;
  isLoading: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

// Storage keys for localStorage
const STORAGE_KEYS = {
  PROFILE_ID: "editai_current_profile_id",
  PROFILES: "editai_profiles",
} as const;

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [currentProfile, setCurrentProfileState] = useState<Profile | null>(null);
  const [profiles, setProfilesState] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Fetch profiles from API and auto-select appropriate profile
   * - Tries to restore last-used profile from localStorage
   * - Falls back to default profile
   * - Falls back to first available profile
   */
  const refreshProfiles = useCallback(async () => {
    try {
      const res = await apiGet("/profiles");

      if (res.ok) {
        const fetchedProfiles: Profile[] = await res.json();
        setProfilesState(fetchedProfiles);
        localStorage.setItem(STORAGE_KEYS.PROFILES, JSON.stringify(fetchedProfiles));

        // Auto-select profile if none currently selected
        if (!currentProfile) {
          const storedId = localStorage.getItem(STORAGE_KEYS.PROFILE_ID);
          let profileToSelect: Profile | null = null;

          // Try to restore last-used profile
          if (storedId) {
            profileToSelect = fetchedProfiles.find((p) => p.id === storedId) || null;
          }

          // Fall back to default profile
          if (!profileToSelect) {
            profileToSelect = fetchedProfiles.find((p) => p.is_default) || null;
          }

          // Fall back to first available profile
          if (!profileToSelect && fetchedProfiles.length > 0) {
            profileToSelect = fetchedProfiles[0];
          }

          if (profileToSelect) {
            setCurrentProfileState(profileToSelect);
            localStorage.setItem(STORAGE_KEYS.PROFILE_ID, profileToSelect.id);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch profiles:", error);
    }
  }, [currentProfile]);

  /**
   * Initialize profiles on mount
   * Strategy: Hydrate from localStorage first (instant UI), then fetch from API (fresh data)
   */
  useEffect(() => {
    async function initialize() {
      setIsLoading(true);

      // Phase 1: Hydrate from localStorage for instant UI (only in browser)
      if (typeof window !== "undefined") {
        const storedProfiles = localStorage.getItem(STORAGE_KEYS.PROFILES);
        const storedProfileId = localStorage.getItem(STORAGE_KEYS.PROFILE_ID);

        if (storedProfiles) {
          try {
            const parsed: Profile[] = JSON.parse(storedProfiles);
            setProfilesState(parsed);

            if (storedProfileId) {
              const profile = parsed.find((p) => p.id === storedProfileId);
              if (profile) {
                setCurrentProfileState(profile);
              }
            }
          } catch (e) {
            console.error("Failed to parse stored profiles:", e);
          }
        }
      }

      // Phase 2: Fetch fresh data from API
      await refreshProfiles();
      setIsLoading(false);
    }

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  /**
   * Set current profile and persist to localStorage
   */
  const setCurrentProfile = useCallback((profile: Profile) => {
    setCurrentProfileState(profile);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.PROFILE_ID, profile.id);
    }
  }, []);

  /**
   * Memoize context value to prevent unnecessary re-renders
   * Only re-compute when dependencies actually change
   */
  const value = useMemo(
    () => ({
      currentProfile,
      profiles,
      setCurrentProfile,
      refreshProfiles,
      isLoading,
    }),
    [currentProfile, profiles, isLoading, setCurrentProfile, refreshProfiles]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/**
 * Hook to access profile context
 * Throws error if used outside ProfileProvider (fail-fast for developer errors)
 */
export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within ProfileProvider");
  }
  return context;
}
