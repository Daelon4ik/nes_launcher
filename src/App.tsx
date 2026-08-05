import { useState } from "react";
import { MainScreen } from "./screens/MainScreen";
import { SettingsScreen } from "./screens/SettingsScreen";

type Screen = "main" | "settings";

export function App() {
  const [screen, setScreen] = useState<Screen>("main");

  if (screen === "settings") {
    return <SettingsScreen onBack={() => setScreen("main")} />;
  }
  return <MainScreen onOpenSettings={() => setScreen("settings")} />;
}
