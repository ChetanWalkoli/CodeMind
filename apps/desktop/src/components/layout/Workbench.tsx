import { useEffect, useState } from "react";
import { ActivityWorkspace } from "../../features/activity/ActivityWorkspace";
import { ArchitectureExplorer } from "../../features/architecture/components/ArchitectureExplorer";
import { DecisionMemoryWorkspace } from "../../features/decisions/DecisionMemoryWorkspace";
import { ImpactWorkspace } from "../../features/impact/ImpactWorkspace";
import { IntentWorkspace } from "../../features/intent/IntentWorkspace";
import { OnboardingModal } from "../../features/onboarding/OnboardingModal";
import { OverviewWorkspace } from "../../features/overview/OverviewWorkspace";
import { desktopApi } from "../../services/desktopApi";
import { useLayoutStore } from "../../stores/layout.store";
import { useWorkspaceStore } from "../../stores/workspace.store";
import { CodeEditor } from "../editor/CodeEditor";
import { EditorTabs } from "../editor/EditorTabs";
import { ExternalConflictDialog } from "../editor/ExternalConflictDialog";
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
  const centerView = useWorkspaceStore((s) => s.centerView);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    let active = true;
    void desktopApi.getAppPreferences().then((res) => {
      if (active && res.ok && !res.data.onboardingCompleted) {
        setShowOnboarding(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

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
              {centerView === "overview" ? (
                <OverviewWorkspace onOpenOnboarding={() => setShowOnboarding(true)} />
              ) : centerView === "architecture" ? (
                <ArchitectureExplorer />
              ) : centerView === "intent" ? (
                <IntentWorkspace />
              ) : centerView === "decisions" ? (
                <DecisionMemoryWorkspace />
              ) : centerView === "impact" ? (
                <ImpactWorkspace />
              ) : centerView === "activity" ? (
                <ActivityWorkspace />
              ) : (
                <>
                  <EditorTabs />
                  <CodeEditor />
                </>
              )}
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
      <ExternalConflictDialog />
      <OnboardingModal open={showOnboarding} onClose={() => setShowOnboarding(false)} />
    </div>
  );
}
