import { create } from "zustand";
import type { ActivityEvent, ActivityFeature } from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

interface ActivityState {
  events: ActivityEvent[];
  featureFilter: "all" | ActivityFeature;
  searchQuery: string;
  isLoading: boolean;
  error: string | null;

  setFeatureFilter: (filter: "all" | ActivityFeature) => void;
  setSearchQuery: (q: string) => void;
  reset: () => void;
  loadActivity: (workspaceRoot: string) => Promise<void>;
  clearActivity: (workspaceRoot: string) => Promise<void>;
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  events: [],
  featureFilter: "all",
  searchQuery: "",
  isLoading: false,
  error: null,

  setFeatureFilter: (featureFilter) => set({ featureFilter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  reset: () =>
    set({
      events: [],
      featureFilter: "all",
      searchQuery: "",
      isLoading: false,
      error: null
    }),

  loadActivity: async (workspaceRoot) => {
    set({ isLoading: true, error: null });
    const { featureFilter, searchQuery } = get();
    const res = await desktopApi.listActivityEvents({
      workspaceRoot,
      feature: featureFilter === "all" ? undefined : featureFilter,
      query: searchQuery.trim() || undefined,
      limit: 100
    });
    if (res.ok) {
      set({ events: res.data, isLoading: false });
    } else {
      set({ isLoading: false, error: res.error.message });
    }
  },

  clearActivity: async (workspaceRoot) => {
    const res = await desktopApi.clearActivityEvents({ workspaceRoot });
    if (res.ok) {
      set({ events: [] });
    } else {
      set({ error: res.error.message });
    }
  }
}));
