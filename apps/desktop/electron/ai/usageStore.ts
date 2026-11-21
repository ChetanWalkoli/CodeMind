import fs from "node:fs";
import path from "node:path";
import { estimateRequestCostUsd } from "@codemind/ai-core";
import {
  AITaskTypeSchema,
  AIUsageSummarySchema,
  type AITaskType,
  type AIUsageSummary
} from "@codemind/shared";
import { z } from "zod";

const UsageRecordSchema = z.object({
  requestId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  taskType: AITaskTypeSchema,
  outcome: z.enum(["success", "error", "cancelled"]),
  errorCategory: z.string().nullable(),
  retryCount: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  usageSource: z.enum(["provider", "estimated"]),
  timestamp: z.string().datetime()
});

export type UsageRecord = z.infer<typeof UsageRecordSchema>;

const UsageFileSchema = z.object({
  version: z.literal(1),
  records: z.array(UsageRecordSchema)
});

const MAX_RECORDS = 200;

/**
 * Privacy-conscious local usage & diagnostics store.
 * Stores ONLY request metadata and token/duration accounting — NEVER API keys,
 * authorization headers, or repository source code.
 */
export class AIUsageStore {
  private readonly filePath: string;
  private records: UsageRecord[] = [];
  private loaded = false;

  constructor(baseDirectory: string) {
    this.filePath = path.join(baseDirectory, "ai-usage.json");
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = UsageFileSchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        this.records = parsed.data.records.slice(-MAX_RECORDS);
      }
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(
        tempPath,
        JSON.stringify({ version: 1, records: this.records }, null, 2),
        "utf8"
      );
      fs.renameSync(tempPath, this.filePath);
    } catch {
      // Non-fatal: usage persistence failure must never crash AI execution
    }
  }

  public record(entry: Omit<UsageRecord, "timestamp"> & { timestamp?: string }): void {
    this.ensureLoaded();
    const validated = UsageRecordSchema.parse({
      ...entry,
      timestamp: entry.timestamp ?? new Date().toISOString()
    });
    this.records.push(validated);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    this.persist();
  }

  public getSummary(): AIUsageSummary {
    this.ensureLoaded();

    let succeededRequests = 0;
    let failedRequests = 0;
    let cancelledRequests = 0;
    let providerReportedInputTokens = 0;
    let providerReportedOutputTokens = 0;
    let estimatedInputTokens = 0;
    let totalDurationMs = 0;
    let totalEstimatedCost = 0;
    let allPriced = this.records.length > 0;

    for (const r of this.records) {
      if (r.outcome === "success") succeededRequests += 1;
      else if (r.outcome === "error") failedRequests += 1;
      else cancelledRequests += 1;

      totalDurationMs += r.durationMs;

      if (r.usageSource === "provider") {
        providerReportedInputTokens += r.inputTokens;
        providerReportedOutputTokens += r.outputTokens;
      } else {
        estimatedInputTokens += r.inputTokens;
      }

      const cost = estimateRequestCostUsd(r.model, {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens
      });
      if (cost.pricingAvailable && cost.estimatedUsd !== null) {
        totalEstimatedCost += cost.estimatedUsd;
      } else {
        allPriced = false;
      }
    }

    const totalRequests = this.records.length;
    const averageDurationMs = totalRequests > 0 ? Math.round(totalDurationMs / totalRequests) : 0;

    return AIUsageSummarySchema.parse({
      totalRequests,
      succeededRequests,
      failedRequests,
      cancelledRequests,
      providerReportedInputTokens,
      providerReportedOutputTokens,
      estimatedInputTokens,
      averageDurationMs,
      estimatedCostUsd: allPriced ? Number(totalEstimatedCost.toFixed(6)) : null,
      recentRequests: this.records
        .slice(-20)
        .reverse()
        .map((r) => ({
          requestId: r.requestId,
          provider: r.provider,
          model: r.model,
          taskType: r.taskType as AITaskType,
          outcome: r.outcome,
          errorCategory: r.errorCategory,
          durationMs: r.durationMs,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          usageSource: r.usageSource,
          timestamp: r.timestamp
        }))
    });
  }
}
