import { useState } from "react";
import { MainScreen } from "./screens/MainScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { EmulatorScreen } from "./screens/EmulatorScreen";
import { NetplayLobbyScreen } from "./screens/NetplayLobbyScreen";
import { StoreScreen } from "./screens/StoreScreen";
import type { Game } from "./types/game";
import type { NetplaySession } from "./types/netplay";

type Screen = "main" | "settings" | "store" | "emulator" | "netplay-lobby";

export function App() {
  const [screen, setScreen] = useState<Screen>("main");
  const [activeGame, setActiveGame] = useState<Game | null>(null);
  const [netplaySession, setNetplaySession] = useState<NetplaySession | null>(null);

  function returnToMain() {
    setScreen("main");
    setActiveGame(null);
    setNetplaySession(null);
  }

  if (screen === "settings") {
    return <SettingsScreen onBack={returnToMain} />;
  }

  if (screen === "store") {
    return <StoreScreen onBack={returnToMain} />;
  }

  if (screen === "netplay-lobby" && activeGame) {
    return (
      <NetplayLobbyScreen
        game={activeGame}
        onBack={returnToMain}
        onReady={(session) => {
          setNetplaySession(session);
          setScreen("emulator");
        }}
      />
    );
  }

  if (screen === "emulator" && activeGame) {
    return <EmulatorScreen game={activeGame} netplay={netplaySession} onExit={returnToMain} />;
  }

  return (
    <MainScreen
      onOpenSettings={() => setScreen("settings")}
      onOpenStore={() => setScreen("store")}
      onPlay={(game) => {
        setActiveGame(game);
        setNetplaySession(null);
        setScreen("emulator");
      }}
      onCoop={(game) => {
        setActiveGame(game);
        setScreen("netplay-lobby");
      }}
    />
  );
}
