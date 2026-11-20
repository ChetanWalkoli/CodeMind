import { create } from "zustand";
import { ThemePreferenceSchema, type ThemePreference } from "@codemind/shared";
import { desktopApi } from "../services/desktopApi";

function applyThemeToDocument(theme: ThemePreference): void {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

interface ThemeState {
  theme: ThemePreference;
  initialized: boolean;
  initTheme: () => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  toggleTheme: () => Promise<void>;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "dark",
  initialized: false,

  async initTheme() {
    const response = await desktopApi.getTheme();
    const resolved: ThemePreference =
      response.ok && ThemePreferenceSchema.safeParse(response.data).success
        ? response.data
        : "dark";

    applyThemeToDocument(resolved);
    set({ theme: resolved, initialized: true });
  },

  async setTheme(theme) {
    const parsed = ThemePreferenceSchema.safeParse(theme);
    if (!parsed.success) return;

    applyThemeToDocument(parsed.data);
    set({ theme: parsed.data });

    await desktopApi.setTheme(parsed.data);
  },

  async toggleTheme() {
    const next: ThemePreference = get().theme === "dark" ? "light" : "dark";
    await get().setTheme(next);
  }
}));
