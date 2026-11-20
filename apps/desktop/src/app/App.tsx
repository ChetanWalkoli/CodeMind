import { useEffect } from "react";
import { Workbench } from "../components/layout/Workbench";
import { useEditorStore } from "../stores/editor.store";
import { useThemeStore } from "../stores/theme.store";
import { useWorkspaceStore } from "../stores/workspace.store";

export function App() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const initializeRuntime = useWorkspaceStore((s) => s.initializeRuntime);
  const restoreLastWorkspace = useWorkspaceStore((s) => s.restoreLastWorkspace);
  const refreshGitStatus = useWorkspaceStore((s) => s.refreshGitStatus);
  const saveActiveTab = useEditorStore((s) => s.saveActiveTab);
  const checkActiveTabExternalChanges = useEditorStore((s) => s.checkActiveTabExternalChanges);

  useEffect(() => {
    void (async () => {
      await Promise.all([initTheme(), initializeRuntime()]);
      await restoreLastWorkspace();
    })();
  }, [initTheme, initializeRuntime, restoreLastWorkspace]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActiveTab().then((saved) => {
          if (saved) {
            void refreshGitStatus();
          }
        });
      }
    };

    const handleFocus = () => {
      void checkActiveTabExternalChanges();
      void refreshGitStatus();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("focus", handleFocus);
    };
  }, [saveActiveTab, checkActiveTabExternalChanges, refreshGitStatus]);

  return <Workbench />;
}
