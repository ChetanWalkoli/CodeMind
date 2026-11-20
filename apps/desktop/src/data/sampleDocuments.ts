export interface SampleDocument {
  id: string;
  title: string;
  content: string;
}

export const SAMPLE_DOCUMENTS: SampleDocument[] = [
  {
    id: "scratch-welcome-ts",
    title: "welcome.ts",
    content: `// CodeMind — In-Memory Scratch Buffer (Phase 1)
// Local project filesystem integration arrives in Phase 2.

export interface ProjectSummary {
  name: string;
  vision: string;
  localFirst: boolean;
}

export function createWelcomeSummary(): ProjectSummary {
  return {
    name: "CodeMind",
    vision: "Understand. Improve. Remember.",
    localFirst: true
  };
}

const summary = createWelcomeSummary();
console.info(summary.name, "—", summary.vision);
`
  },
  {
    id: "scratch-component-tsx",
    title: "ExamplePanel.tsx",
    content: `import React from "react";

interface ExamplePanelProps {
  title: string;
  items: string[];
}

export function ExamplePanel({ title, items }: ExamplePanelProps) {
  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
`
  },
  {
    id: "scratch-config-json",
    title: "codemind.config.json",
    content: `{
  "product": "CodeMind",
  "mode": "local-first",
  "editor": {
    "tabSize": 2,
    "wordWrap": "off",
    "minimap": true
  },
  "exclude": ["node_modules", ".git", "dist"]
}
`
  }
];
