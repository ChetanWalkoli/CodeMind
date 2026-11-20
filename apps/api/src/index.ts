import { APP_CONSTANTS } from "@codemind/config";

export interface HealthStatus {
  service: string;
  status: "ok";
  apiPrefix: string;
  timestamp: string;
}

export function getHealthStatus(): HealthStatus {
  return {
    service: `${APP_CONSTANTS.APP_NAME}-api`,
    status: "ok",
    apiPrefix: APP_CONSTANTS.API_PREFIX,
    timestamp: new Date().toISOString()
  };
}
