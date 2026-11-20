import {
  SetThemeRequestSchema,
  ThemePreferenceSchema,
  type IpcResponse,
  type ThemePreference
} from "@codemind/shared";
import type { PreferencesStore } from "../../utils/preferences.js";

export function createThemeHandlers(preferences: PreferencesStore) {
  return {
    getTheme(): IpcResponse<ThemePreference> {
      const theme = preferences.getTheme();
      const parsed = ThemePreferenceSchema.safeParse(theme);

      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_STORED_THEME",
            message: "Stored theme preference is invalid."
          }
        };
      }

      return { ok: true, data: parsed.data };
    },

    setTheme(payload: unknown): IpcResponse<ThemePreference> {
      const parsed = SetThemeRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: "INVALID_PAYLOAD",
            message: parsed.error.issues.map((issue) => issue.message).join("; ")
          }
        };
      }

      try {
        const saved = preferences.setTheme(parsed.data.theme);
        return { ok: true, data: saved };
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "THEME_PERSIST_FAILED",
            message: err instanceof Error ? err.message : "Failed to save theme preference."
          }
        };
      }
    }
  };
}
