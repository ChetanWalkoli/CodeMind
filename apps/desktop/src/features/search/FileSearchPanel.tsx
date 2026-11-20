import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { FileSearchMatch } from "@codemind/shared";
import { desktopApi } from "../../services/desktopApi";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./FileSearchPanel.module.scss";

export function FileSearchPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const customExcludes = useWorkspaceStore((s) => s.customExcludes);
  const persistSession = useWorkspaceStore((s) => s.persistSession);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FileSearchMatch[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!workspace || !query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(() => {
      void desktopApi
        .searchWorkspaceFiles({
          workspaceRoot: workspace.rootPath,
          query: query.trim(),
          maxResults: 100,
          customExcludes
        })
        .then((res) => {
          if (cancelled) return;
          setResults(res.ok ? res.data : []);
          setSearching(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace, query, customExcludes]);

  if (!workspace) {
    return (
      <div className={styles.emptyCard} data-testid="file-search-empty">
        Open a project folder in Explorer to search workspace filenames.
      </div>
    );
  }

  return (
    <div className={styles.panel} data-testid="file-search-panel">
      <div className={styles.inputWrap}>
        <Search size={13} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.input}
          placeholder="Search files by name..."
          aria-label="Search workspace files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim() && (
        <div className={styles.meta}>
          {searching
            ? "Searching..."
            : `${results.length} matching file${results.length === 1 ? "" : "s"}`}
        </div>
      )}

      <div className={styles.results} role="list" aria-label="File search results">
        {results.map((match) => (
          <button
            key={match.relativePath}
            type="button"
            role="listitem"
            className={styles.resultItem}
            onClick={async () => {
              const opened = await openWorkspaceFile(workspace.rootPath, match.relativePath);
              if (opened.ok) {
                void persistSession();
              }
            }}
            title={match.relativePath}
          >
            <span className={styles.resultName}>{match.name}</span>
            <span className={styles.resultPath}>{match.relativePath}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
