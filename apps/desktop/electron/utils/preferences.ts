import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ThemePreferenceSchema, type ThemePreference } from "@codemind/shared";

const PreferencesFileSchema = z.object({
  theme: ThemePreferenceSchema.default("dark")
});

export type StoredPreferences = z.infer<typeof PreferencesFileSchema>;

const DEFAULT_PREFERENCES: StoredPreferences = {
  theme: "dark"
};

/**
 * Validated JSON preferences store scoped strictly to the Electron userData directory.
 */
export class PreferencesStore {
  private readonly filePath: string;

  constructor(baseDirectory: string) {
    this.filePath = path.join(baseDirectory, "preferences.json");
  }

  public read(): StoredPreferences {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_PREFERENCES };
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsedJson: unknown = JSON.parse(raw);
      const validated = PreferencesFileSchema.safeParse(parsedJson);

      if (!validated.success) {
        return { ...DEFAULT_PREFERENCES };
      }

      return validated.data;
    } catch {
      return { ...DEFAULT_PREFERENCES };
    }
  }

  public getTheme(): ThemePreference {
    return this.read().theme;
  }

  public setTheme(theme: ThemePreference): ThemePreference {
    const validatedTheme = ThemePreferenceSchema.parse(theme);
    const current = this.read();
    const next: StoredPreferences = {
      ...current,
      theme: validatedTheme
    };

    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);

    return validatedTheme;
  }
}
