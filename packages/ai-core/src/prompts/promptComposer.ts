import type { AIContextSnapshot } from "@codemind/shared";
import type { AIMessage } from "../types/ai.types.js";
import {
  UNTRUSTED_CONTEXT_SECURITY_POLICY,
  wrapUntrustedRepositoryContext
} from "./injectionBoundary.js";
import { getPromptTemplate } from "./templates.js";

/**
 * Deterministically composes provider-independent system + user messages from an
 * assembled AIContextSnapshot. Pure function — never triggers any AI network request.
 */
export function composePromptMessages(snapshot: AIContextSnapshot): AIMessage[] {
  const template = getPromptTemplate(snapshot.taskType);

  const systemContent = [
    template.systemInstructions,
    "",
    UNTRUSTED_CONTEXT_SECURITY_POLICY,
    "",
    `Template: ${template.id}@${template.version}`,
    `Output Guidelines: ${template.outputGuidelines}`
  ].join("\n");

  const referenceIndex =
    snapshot.items.length > 0
      ? snapshot.items
          .map(
            (item, idx) =>
              `[${idx + 1}] ${item.filePath}:${item.startLine}-${item.endLine} (${item.reasons.join(", ")})`
          )
          .join("\n")
      : "(none)";

  const userContent = [
    `Developer Request (${snapshot.taskType}):`,
    snapshot.query,
    "",
    `Context Snapshot ID: ${snapshot.snapshotId}`,
    "Included Source References:",
    referenceIndex,
    "",
    wrapUntrustedRepositoryContext(snapshot.items)
  ].join("\n");

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
}
