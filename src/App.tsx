import { useState } from "react";
import { MainScreen } from "./screens/MainScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EmulatorScreen } from "./screens/EmulatorScreen";
import type { Game } from "./types/game";

type Screen = "main" | "settings" | "emulator";

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [activeGame, setActiveGame] = useState<Game | null>(null);

  if (screen === "settings") {
    return <SettingsScreen onBack={() => setScreen("main")} />;
  }

  if (screen === "emulator" && activeGame) {
    return (
      <EmulatorScreen
        game={activeGame}
        onExit={() => {
          setScreen("main");
          setActiveGame(null);
        }}
      />
    );
  }

  return (
    <MainScreen
      onOpenSettings={() => setScreen("settings")}
      onPlay={(game) => {
        setActiveGame(game);
        setScreen("emulator");
      }}
    />
  );
}
