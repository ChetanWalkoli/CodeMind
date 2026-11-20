import { useEffect } from "react";
import { Workbench } from "../components/layout/Workbench";
import { useThemeStore } from "../stores/theme.store";
import { useWorkspaceStore } from "../stores/workspace.store";

export function App() {
  const initTheme = useThemeStore((s) => s.initTheme);
  const initializeRuntime = useWorkspaceStore((s) => s.initializeRuntime);

  useEffect(() => {
    void initTheme();
    void initializeRuntime();
  }, [initTheme, initializeRuntime]);

  return <Workbench />;
}
