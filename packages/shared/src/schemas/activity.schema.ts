import { z } from "zod";

export const ACTIVITY_SCHEMA_VERSION = 1 as const;
export const APP_PREFERENCES_SCHEMA_VERSION = 1 as const;

export const ActivityFeatureSchema = z.enum([
  "workspace",
  "understand",
  "improve",
  "remember",
  "predict",
  "ai",
  "settings"
]);
export type ActivityFeature = z.infer<typeof ActivityFeatureSchema>;

export const ActivityEventTypeSchema = z.enum([
  "workspace_opened",
  "codebase_indexed",
  "architecture_explored",
  "intent_created",
  "investigation_completed",
  "patch_generated",
  "patch_approved",
  "patch_applied",
  "verification_completed",
  "decision_drafted",
  "decision_accepted",
  "decision_superseded",
  "impact_completed",
  "impact_stale"
]);
export type ActivityEventType = z.infer<typeof ActivityEventTypeSchema>;

export const ActivityStatusSchema = z.enum(["success", "warning", "error", "info"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const ActivityEventSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  eventType: ActivityEventTypeSchema,
  timestamp: z.string().datetime(),
  feature: ActivityFeatureSchema,
  relatedRecordId: z.string().max(128).optional(),
  relatedFiles: z.array(z.string().max(400)).max(20).default([]),
  summary: z.string().min(1).max(300),
  status: ActivityStatusSchema.default("success"),
  schemaVersion: z.literal(ACTIVITY_SCHEMA_VERSION).default(ACTIVITY_SCHEMA_VERSION)
});
export type ActivityEvent = z.infer<typeof ActivityEventSchema>;

export const AppPreferencesSchema = z.object({
  schemaVersion: z.literal(APP_PREFERENCES_SCHEMA_VERSION).default(APP_PREFERENCES_SCHEMA_VERSION),
  editorFontSize: z.number().int().min(10).max(24).default(13),
  reopenLastWorkspace: z.boolean().default(true),
  onboardingCompleted: z.boolean().default(false),
  confirmBeforePatchApply: z.boolean().default(true),
  confirmBeforeCommandRun: z.boolean().default(true)
});
export type AppPreferences = z.infer<typeof AppPreferencesSchema>;

export const AppPreferencesPatchSchema = z.object({
  editorFontSize: z.number().int().min(10).max(24).optional(),
  reopenLastWorkspace: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional()
});
export type AppPreferencesPatch = z.infer<typeof AppPreferencesPatchSchema>;

export const DiagnosticsSnapshotSchema = z.object({
  generatedAt: z.string().datetime(),
  appName: z.string(),
  appVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  chromeVersion: z.string(),
  workspace: z.object({
    authorized: z.boolean(),
    name: z.string().nullable(),
    indexedFiles: z.number().int().nonnegative(),
    indexedSymbols: z.number().int().nonnegative()
  }),
  ai: z.object({
    provider: z.string(),
    configured: z.boolean(),
    model: z.string(),
    credentialCorrupt: z.boolean()
  }),
  persistence: z.object({
    localFirst: z.literal(true),
    cloudSyncEnabled: z.literal(false),
    preferencesHealthy: z.boolean(),
    decisionsCount: z.number().int().nonnegative(),
    impactAnalysesCount: z.number().int().nonnegative(),
    activityEventsCount: z.number().int().nonnegative()
  }),
  security: z.object({
    contextIsolation: z.literal(true),
    nodeIntegration: z.literal(false),
    sandbox: z.literal(true),
    explicitPatchApprovalRequired: z.literal(true),
    explicitCommandApprovalRequired: z.literal(true)
  }),
  recentErrorCategories: z.array(z.string().max(120)).max(20).default([])
});
export type DiagnosticsSnapshot = z.infer<typeof DiagnosticsSnapshotSchema>;
