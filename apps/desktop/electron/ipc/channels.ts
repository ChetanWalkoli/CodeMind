import { IPC_CHANNELS } from "@codemind/shared";

/**
 * Explicitly allowlisted IPC channels for Phase 1.
 * Filesystem and shell channels are intentionally NOT registered in Phase 1.
 */
export const APPROVED_PHASE1_CHANNELS = [
  IPC_CHANNELS.APP_GET_INFO,
  IPC_CHANNELS.APP_GET_PLATFORM,
  IPC_CHANNELS.APP_HEALTH_CHECK,
  IPC_CHANNELS.THEME_GET,
  IPC_CHANNELS.THEME_SET
] as const;

export type ApprovedPhase1Channel = (typeof APPROVED_PHASE1_CHANNELS)[number];

export function isApprovedPhase1Channel(channel: string): channel is ApprovedPhase1Channel {
  return (APPROVED_PHASE1_CHANNELS as readonly string[]).includes(channel);
}
