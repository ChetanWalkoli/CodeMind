import { describe, expect, it } from "vitest";
import { getHealthStatus } from "./index.js";

describe("@codemind/api foundation", () => {
  it("returns ok health status with versioned API prefix", () => {
    const health = getHealthStatus();
    expect(health.status).toBe("ok");
    expect(health.apiPrefix).toBe("/api/v1");
  });
});
