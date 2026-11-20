import { useLayoutStore } from "../../stores/layout.store";
import { CodeEditor } from "../editor/CodeEditor";
import { EditorTabs } from "../editor/EditorTabs";
import { UnsavedChangesDialog } from "../editor/UnsavedChangesDialog";
import { ActivityBar } from "./ActivityBar";
import { BottomPanel } from "./BottomPanel";
import { ResizeHandle } from "./ResizeHandle";
import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { WorkspaceToolbar } from "./WorkspaceToolbar";
import styles from "./Workbench.module.scss";

export function Workbench() {
  const sidebarVisible = useLayoutStore((s) => s.sidebarVisible);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);

  const rightPanelVisible = useLayoutStore((s) => s.rightPanelVisible);
  const rightPanelWidth = useLayoutStore((s) => s.rightPanelWidth);
  const setRightPanelWidth = useLayoutStore((s) => s.setRightPanelWidth);

  const bottomPanelVisible = useLayoutStore((s) => s.bottomPanelVisible);
  const bottomPanelHeight = useLayoutStore((s) => s.bottomPanelHeight);
  const setBottomPanelHeight = useLayoutStore((s) => s.setBottomPanelHeight);

  return (
    <div className={styles.shell}>
      <TitleBar />

      <div className={styles.body}>
        <ActivityBar />

        <Sidebar />
        {sidebarVisible && (
          <ResizeHandle
            orientation="vertical"
            ariaLabel="Resize primary sidebar"
            onResizeDelta={(delta) => setSidebarWidth(sidebarWidth + delta)}
          />
        )}

        <main className={styles.workspaceColumn}>
          <WorkspaceToolbar />

          <div className={styles.centerRow}>
            <div className={styles.editorColumn}>
              <EditorTabs />
              <CodeEditor />
            </div>

            {rightPanelVisible && (
              <ResizeHandle
                orientation="vertical"
                ariaLabel="Resize right panel"
                onResizeDelta={(delta) => setRightPanelWidth(rightPanelWidth - delta)}
              />
            )}
            <RightPanel />
          </div>

          {bottomPanelVisible && (
            <ResizeHandle
              orientation="horizontal"
              ariaLabel="Resize bottom panel"
              onResizeDelta={(delta) => setBottomPanelHeight(bottomPanelHeight - delta)}
            />
          )}
          <BottomPanel />
        </main>
      </div>

      <StatusBar />
      <UnsavedChangesDialog />
    </div>
  );
}
