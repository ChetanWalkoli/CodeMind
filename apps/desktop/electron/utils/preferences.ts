import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AIProviderNameSchema,
  ThemePreferenceSchema,
  WorkspaceSessionSchema,
  type AIProviderName,
  type ThemePreference,
  type WorkspaceSession
} from "@codemind/shared";

export const AISettingsSchema = z.object({
  provider: AIProviderNameSchema.default("gemini"),
  model: z.string().min(1).default("gemini-3.8-flash")
});

export type StoredAISettings = z.infer<typeof AISettingsSchema>;

const DEFAULT_AI_SETTINGS: StoredAISettings = {
  provider: "gemini",
  model: "gemini-3.8-flash"
};

const DEFAULT_WORKSPACE_SESSION: WorkspaceSession = {
  lastWorkspacePath: null,
  openTabPaths: [],
  activeTabPath: null,
  customExcludes: []
};

const PreferencesFileSchema = z.object({
  theme: ThemePreferenceSchema.default("dark"),
  workspaceSession: WorkspaceSessionSchema.default(DEFAULT_WORKSPACE_SESSION),
  aiSettings: AISettingsSchema.default(DEFAULT_AI_SETTINGS)
});

export type StoredPreferences = z.infer<typeof PreferencesFileSchema>;

const DEFAULT_PREFERENCES: StoredPreferences = {
  theme: "dark",
  workspaceSession: { ...DEFAULT_WORKSPACE_SESSION },
  aiSettings: { ...DEFAULT_AI_SETTINGS }
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
    const fallback = (): StoredPreferences => ({
      theme: DEFAULT_PREFERENCES.theme,
      workspaceSession: { ...DEFAULT_WORKSPACE_SESSION },
      aiSettings: { ...DEFAULT_AI_SETTINGS }
    });

    try {
      if (!fs.existsSync(this.filePath)) {
        return fallback();
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsedJson: unknown = JSON.parse(raw);
      const validated = PreferencesFileSchema.safeParse(parsedJson);

      if (validated.success) {
        // Migrate retired Gemini 2.5 models to the current default Flash model
        if (validated.data.aiSettings.model.startsWith("gemini-2.5-")) {
          const migrated: StoredPreferences = {
            ...validated.data,
            aiSettings: { ...DEFAULT_AI_SETTINGS }
          };
          this.write(migrated);
          return migrated;
        }
        return validated.data;
      }

      // Safely migrate legacy preferences (e.g. removed provider) without losing theme or workspaceSession
      if (parsedJson && typeof parsedJson === "object") {
        const obj = parsedJson as Record<string, unknown>;
        const theme = ThemePreferenceSchema.safeParse(obj.theme);
        const ws = WorkspaceSessionSchema.safeParse(obj.workspaceSession);
        const migrated: StoredPreferences = {
          theme: theme.success ? theme.data : DEFAULT_PREFERENCES.theme,
          workspaceSession: ws.success ? ws.data : { ...DEFAULT_WORKSPACE_SESSION },
          aiSettings: { ...DEFAULT_AI_SETTINGS }
        };
        this.write(migrated);
        return migrated;
      }

      return fallback();
    } catch {
      return fallback();
    }
  }

  private write(next: StoredPreferences): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tempPath, this.filePath);
  }

  public getTheme(): ThemePreference {
    return this.read().theme;
  }

  public setTheme(theme: ThemePreference): ThemePreference {
    const validatedTheme = ThemePreferenceSchema.parse(theme);
    const current = this.read();
    this.write({
      ...current,
      theme: validatedTheme
    });
    return validatedTheme;
  }

  public getWorkspaceSession(): WorkspaceSession {
    return this.read().workspaceSession;
  }

  public saveWorkspaceSession(session: WorkspaceSession): WorkspaceSession {
    const validatedSession = WorkspaceSessionSchema.parse(session);
    const current = this.read();
    this.write({
      ...current,
      workspaceSession: validatedSession
    });
    return validatedSession;
  }

  public getAISettings(): StoredAISettings {
    return this.read().aiSettings;
  }

  public saveAISettings(settings: { provider: AIProviderName; model: string }): StoredAISettings {
    const validated = AISettingsSchema.parse(settings);
    const current = this.read();
    this.write({
      ...current,
      aiSettings: validated
    });
    return validated;
  }
}
