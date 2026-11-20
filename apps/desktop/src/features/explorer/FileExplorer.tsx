import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Lock,
  RefreshCw,
  ShieldAlert
} from "lucide-react";
import type { FileTreeNode } from "@codemind/shared";
import { SAMPLE_DOCUMENTS } from "../../data/sampleDocuments";
import { useEditorStore } from "../../stores/editor.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import styles from "./FileExplorer.module.scss";

function renderFileIcon(node: FileTreeNode) {
  if (node.unreadable) {
    return <Lock size={13} className={styles.nodeIcon} aria-hidden="true" />;
  }
  if (node.isSecret) {
    return <ShieldAlert size={13} className={styles.nodeIcon} aria-hidden="true" />;
  }
  switch (node.extension) {
    case ".json":
      return <FileJson size={13} className={styles.nodeIcon} aria-hidden="true" />;
    case ".ts":
    case ".tsx":
    case ".js":
    case ".jsx":
    case ".css":
    case ".scss":
    case ".html":
    case ".py":
    case ".java":
    case ".sql":
      return <FileCode2 size={13} className={styles.nodeIcon} aria-hidden="true" />;
    case ".md":
    case ".txt":
      return <FileText size={13} className={styles.nodeIcon} aria-hidden="true" />;
    default:
      return <File size={13} className={styles.nodeIcon} aria-hidden="true" />;
  }
}

interface TreeBranchProps {
  nodes: FileTreeNode[];
  depth: number;
  workspaceRoot: string;
}

function TreeBranch({ nodes, depth, workspaceRoot }: TreeBranchProps) {
  const expandedPaths = useWorkspaceStore((s) => s.expandedPaths);
  const childrenByPath = useWorkspaceStore((s) => s.childrenByPath);
  const loadingPaths = useWorkspaceStore((s) => s.loadingPaths);
  const toggleDirectory = useWorkspaceStore((s) => s.toggleDirectory);
  const persistSession = useWorkspaceStore((s) => s.persistSession);

  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const openWorkspaceFile = useEditorStore((s) => s.openWorkspaceFile);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <>
      {nodes.map((node) => {
        const isExpanded = Boolean(expandedPaths[node.relativePath]);
        const isLoading = Boolean(loadingPaths[node.relativePath]);
        const childNodes = childrenByPath[node.relativePath] ?? [];
        const isActive = node.kind === "file" && activeTab?.relativePath === node.relativePath;
        const paddingLeft = 6 + depth * 14;

        if (node.kind === "directory") {
          return (
            <div key={node.relativePath}>
              <button
                type="button"
                className={`${styles.treeRow} ${node.unreadable ? styles.treeRowUnreadable : ""}`}
                style={{ paddingLeft: `${paddingLeft}px` }}
                onClick={() => {
                  if (!node.unreadable) {
                    void toggleDirectory(node.relativePath);
                  }
                }}
                aria-expanded={isExpanded}
                title={node.unreadable ? `${node.relativePath} (unreadable)` : node.relativePath}
              >
                <span className={styles.chevron} aria-hidden="true">
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                {isExpanded ? (
                  <FolderOpen size={13} className={styles.nodeIcon} aria-hidden="true" />
                ) : (
                  <Folder size={13} className={styles.nodeIcon} aria-hidden="true" />
                )}
                <span className={styles.nodeName}>{node.name}</span>
                {node.unreadable && <span className={styles.nodeTag}>unreadable</span>}
              </button>

              {isExpanded && (
                <div>
                  {isLoading ? (
                    <div
                      className={styles.emptyDirNote}
                      style={{ paddingLeft: `${paddingLeft + 22}px` }}
                    >
                      Loading...
                    </div>
                  ) : childNodes.length === 0 ? (
                    <div
                      className={styles.emptyDirNote}
                      style={{ paddingLeft: `${paddingLeft + 22}px` }}
                    >
                      Empty folder
                    </div>
                  ) : (
                    <TreeBranch
                      nodes={childNodes}
                      depth={depth + 1}
                      workspaceRoot={workspaceRoot}
                    />
                  )}
                </div>
              )}
            </div>
          );
        }

        return (
          <button
            key={node.relativePath}
            type="button"
            className={`${styles.treeRow} ${isActive ? styles.treeRowActive : ""} ${
              node.unreadable ? styles.treeRowUnreadable : ""
            }`}
            style={{ paddingLeft: `${paddingLeft + 14}px` }}
            onClick={async () => {
              if (node.unreadable) return;
              const result = await openWorkspaceFile(workspaceRoot, node.relativePath);
              if (result.ok) {
                void persistSession();
              }
            }}
            title={
              node.isSecret
                ? `${node.relativePath} (secret file — excluded from indexing)`
                : node.relativePath
            }
          >
            {renderFileIcon(node)}
            <span className={styles.nodeName}>{node.name}</span>
            {node.isSecret && <span className={styles.nodeTag}>secret</span>}
          </button>
        );
      })}
    </>
  );
}

export function FileExplorer() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const rootNodes = useWorkspaceStore((s) => s.rootNodes);
  const isTreeLoading = useWorkspaceStore((s) => s.isTreeLoading);
  const workspaceError = useWorkspaceStore((s) => s.workspaceError);
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog);
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  const openTab = useEditorStore((s) => s.openTab);

  if (!workspace) {
    return (
      <div className={styles.explorer} data-testid="file-explorer-empty">
        {workspaceError && (
          <div className={styles.errorBanner} role="alert">
            {workspaceError}
          </div>
        )}

        <div className={styles.emptyCard}>
          <p className={styles.emptyTitle}>No Workspace Open</p>
          <p className={styles.emptyText}>Open a project to begin exploring your codebase.</p>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => void openFolderDialog()}
          >
            <FolderOpen size={14} aria-hidden="true" />
            <span>Open Folder</span>
          </button>
        </div>

        <div className={styles.scratchSection}>
          <p className={styles.scratchLabel}>Sample Scratch Buffers</p>
          <div className={styles.sampleList}>
            {SAMPLE_DOCUMENTS.map((doc) => (
              <button
                key={doc.id}
                type="button"
                className={styles.sampleItem}
                onClick={() => openTab({ ...doc, isInMemory: true })}
              >
                <FileCode2 size={13} aria-hidden="true" />
                <span>{doc.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.explorer} data-testid="file-explorer">
      <div className={styles.workspaceHeader}>
        <div className={styles.workspaceTitleRow}>
          <span className={styles.workspaceName} title={workspace.name}>
            {workspace.name}
          </span>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void openFolderDialog()}
              aria-label="Open different folder"
              title="Open Folder"
            >
              <FolderOpen size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void refreshWorkspace()}
              aria-label="Refresh file explorer"
              title="Refresh Explorer"
            >
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <span className={styles.workspacePath} title={workspace.rootPath}>
          {workspace.rootPath}
        </span>
      </div>

      {workspaceError && (
        <div className={styles.errorBanner} role="alert">
          {workspaceError}
        </div>
      )}

      {isTreeLoading ? (
        <div className={styles.emptyDirNote}>Loading workspace files...</div>
      ) : rootNodes.length === 0 ? (
        <div className={styles.emptyCard}>
          <p className={styles.emptyText}>This folder has no visible files.</p>
        </div>
      ) : (
        <div className={styles.treeList} role="tree" aria-label="Workspace files">
          <TreeBranch nodes={rootNodes} depth={0} workspaceRoot={workspace.rootPath} />
        </div>
      )}
    </div>
  );
}
