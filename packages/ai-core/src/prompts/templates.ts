import type { AITaskType } from "@codemind/shared";

export interface PromptTemplate {
  readonly id: string;
  readonly version: string;
  readonly taskType: AITaskType;
  readonly displayName: string;
  readonly description: string;
  readonly systemInstructions: string;
  readonly outputGuidelines: string;
}

export const PROMPT_TEMPLATES: Record<AITaskType, PromptTemplate> = {
  "code-qa": {
    id: "codemind.code-qa",
    version: "1.0.0",
    taskType: "code-qa",
    displayName: "Codebase Q&A",
    description: "Answer targeted developer questions grounded in retrieved workspace files.",
    systemInstructions:
      "You are CodeMind, a precision software architecture and code intelligence assistant. Answer the developer's question strictly using the verified repository context provided.",
    outputGuidelines:
      "Cite exact file paths and line ranges (e.g., src/app.ts:12-28) for every claim. Explicitly state any missing context or uncertainty instead of guessing."
  },
  "explain-codebase": {
    id: "codemind.explain-codebase",
    version: "1.0.0",
    taskType: "explain-codebase",
    displayName: "Explain My Codebase",
    description: "Explain project architecture, entry points, modules, and key execution flows.",
    systemInstructions:
      "You are CodeMind, an architectural intelligence assistant. Explain how the repository is organized, how modules interact, and how data and control flow through the provided files.",
    outputGuidelines:
      "Structure the explanation into: (1) High-Level Architecture, (2) Key Modules & Responsibilities, (3) Execution & Dependency Flows, and (4) Referenced Source Locations."
  },
  "explain-file": {
    id: "codemind.explain-file",
    version: "1.0.0",
    taskType: "explain-file",
    displayName: "Explain File",
    description: "Explain a specific file, its exported symbols, dependencies, and callers.",
    systemInstructions:
      "You are CodeMind. Explain the purpose, internal logic, exported symbols, incoming dependents, and outgoing dependencies of the focused file using the provided source context.",
    outputGuidelines:
      "Reference concrete symbol names and line ranges. Distinguish verified behavior from assumptions if any dependencies were omitted."
  },
  "architecture-overview": {
    id: "codemind.architecture-overview",
    version: "1.0.0",
    taskType: "architecture-overview",
    displayName: "Architecture Overview",
    description: "Summarize structural layers, boundaries, and coupling across workspace modules.",
    systemInstructions:
      "You are CodeMind. Summarize the structural architecture, module boundaries, external dependencies, and potential coupling hotspots based solely on the provided context.",
    outputGuidelines:
      "Be factual and concise. Cite exact module paths and dependency relationships observed in the context."
  },
  "impact-analysis": {
    id: "codemind.impact-analysis",
    version: "1.0.0",
    taskType: "impact-analysis",
    displayName: "Change Impact Analysis",
    description: "Assess downstream files, callers, and regression risks for a proposed change.",
    systemInstructions:
      "You are CodeMind. Analyze the blast radius and downstream impact of the developer's proposed change using the provided source files and dependency relationships.",
    outputGuidelines:
      "List directly affected files, indirect callers, contract/type risks, and recommended verification steps with exact file and symbol citations."
  }
};

export function getPromptTemplate(taskType: AITaskType): PromptTemplate {
  return PROMPT_TEMPLATES[taskType];
}

export function listPromptTemplates(): PromptTemplate[] {
  return Object.values(PROMPT_TEMPLATES);
}
