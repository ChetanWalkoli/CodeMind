import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ThemePreferenceSchema,
  WorkspaceSessionSchema,
  type ThemePreference,
  type WorkspaceSession
} from "@codemind/shared";

const DEFAULT_WORKSPACE_SESSION: WorkspaceSession = {
  lastWorkspacePath: null,
  openTabPaths: [],
  activeTabPath: null,
  customExcludes: []
};

const PreferencesFileSchema = z.object({
  theme: ThemePreferenceSchema.default("dark"),
  workspaceSession: WorkspaceSessionSchema.default(DEFAULT_WORKSPACE_SESSION)
});

export type StoredPreferences = z.infer<typeof PreferencesFileSchema>;

const DEFAULT_PREFERENCES: StoredPreferences = {
  theme: "dark",
  workspaceSession: { ...DEFAULT_WORKSPACE_SESSION }
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
        return {
          theme: DEFAULT_PREFERENCES.theme,
          workspaceSession: { ...DEFAULT_WORKSPACE_SESSION }
        };
      }

      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsedJson: unknown = JSON.parse(raw);
      const validated = PreferencesFileSchema.safeParse(parsedJson);

      if (!validated.success) {
        return {
          theme: DEFAULT_PREFERENCES.theme,
          workspaceSession: { ...DEFAULT_WORKSPACE_SESSION }
        };
      }

      return validated.data;
    } catch {
      return {
        theme: DEFAULT_PREFERENCES.theme,
        workspaceSession: { ...DEFAULT_WORKSPACE_SESSION }
      };
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
}
