import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { FileSearchMatch, SymbolSearchResult } from "@codemind/shared";
import { desktopApi } from "../../services/desktopApi";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./FileSearchPanel.module.scss";

type SearchMode = "files" | "symbols";

export function FileSearchPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const customExcludes = useWorkspaceStore((s) => s.customExcludes);
  const persistSession = useWorkspaceStore((s) => s.persistSession);
  const setCenterView = useWorkspaceStore((s) => s.setCenterView);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);

  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [fileResults, setFileResults] = useState<FileSearchMatch[]>([]);
  const [symbolResults, setSymbolResults] = useState<SymbolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!workspace || !query.trim()) {
      setFileResults([]);
      setSymbolResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(() => {
      if (mode === "files") {
        void desktopApi
          .searchWorkspaceFiles({
            workspaceRoot: workspace.rootPath,
            query: query.trim(),
            maxResults: 100,
            customExcludes
          })
          .then((res) => {
            if (cancelled) return;
            setFileResults(res.ok ? res.data : []);
            setSearching(false);
          });
      } else {
        void desktopApi
          .searchSymbols({
            workspaceRoot: workspace.rootPath,
            query: query.trim(),
            limit: 80
          })
          .then((res) => {
            if (cancelled) return;
            setSymbolResults(res.ok ? res.data : []);
            setSearching(false);
          });
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspace, query, mode, customExcludes]);

  if (!workspace) {
    return (
      <div className={styles.emptyCard} data-testid="file-search-empty">
        Open a project folder in Explorer to search workspace files and symbols.
      </div>
    );
  }

  const count = mode === "files" ? fileResults.length : symbolResults.length;

  return (
    <div className={styles.panel} data-testid="file-search-panel">
      <div className={styles.modeTabs} role="tablist" aria-label="Search scope">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "files"}
          className={`${styles.modeBtn} ${mode === "files" ? styles.modeBtnActive : ""}`}
          onClick={() => setMode("files")}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "symbols"}
          className={`${styles.modeBtn} ${mode === "symbols" ? styles.modeBtnActive : ""}`}
          onClick={() => setMode("symbols")}
        >
          Symbols
        </button>
      </div>

      <div className={styles.inputWrap}>
        <Search size={13} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="search"
          className={styles.input}
          placeholder={
            mode === "files" ? "Search files by name..." : "Search functions, classes, hooks..."
          }
          aria-label={mode === "files" ? "Search workspace files" : "Search workspace symbols"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {query.trim() && (
        <div className={styles.meta}>
          {searching
            ? "Searching..."
            : `${count} matching ${mode === "files" ? "file" : "symbol"}${count === 1 ? "" : "s"}`}
        </div>
      )}

      {mode === "files" ? (
        <div className={styles.results} role="list" aria-label="File search results">
          {fileResults.map((match) => (
            <button
              key={match.relativePath}
              type="button"
              role="listitem"
              className={styles.resultItem}
              onClick={async () => {
                const opened = await openWorkspaceFile(workspace.rootPath, match.relativePath);
                if (opened.ok) {
                  setCenterView("editor");
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
      ) : (
        <div className={styles.results} role="list" aria-label="Symbol search results">
          {symbolResults.map(({ symbol }) => (
            <button
              key={symbol.id}
              type="button"
              role="listitem"
              className={styles.resultItem}
              onClick={async () => {
                const opened = await openWorkspaceFile(workspace.rootPath, symbol.filePath, {
                  line: symbol.startLine,
                  column: 1
                });
                if (opened.ok) {
                  setCenterView("editor");
                  void persistSession();
                }
              }}
              title={`${symbol.filePath}:${symbol.startLine}`}
            >
              <div className={styles.symbolRow}>
                <span className={styles.resultName}>{symbol.name}</span>
                <span className={styles.kindBadge}>{symbol.kind}</span>
              </div>
              <span className={styles.resultPath}>
                {symbol.filePath}:{symbol.startLine}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
