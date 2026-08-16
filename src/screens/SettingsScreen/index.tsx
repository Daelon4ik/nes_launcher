// Экран настроек: библиотека, метаданные, эмулятор, лаунчер.
// См. docs/screens.md#2-settings-screen
import { useEffect, useRef, useState } from "react";
import { Library, Settings, Store } from "lucide-react";
import { useSpatialNavigation } from "../../hooks/useSpatialNavigation";
import { getTheme, setTheme as persistTheme } from "../../api/settings";
import type { Theme } from "../../types/settings";
import { LibraryTab } from "./LibraryTab";
import { MetadataTab } from "./MetadataTab";
import { EmulatorTab } from "./EmulatorTab";
import { NetworkTab } from "./NetworkTab";
import { LauncherTab } from "./LauncherTab";
import logo from "../../assets/logo.png";
import controllerImg from "../../assets/controller.png";
import styles from "./SettingsScreen.module.css";

type TabId = "library" | "metadata" | "emulator" | "network" | "launcher";

const TABS: { id: TabId; label: string }[] = [
  { id: "library", label: "Библиотека" },
  { id: "metadata", label: "Метаданные" },
  { id: "emulator", label: "Эмулятор" },
  { id: "network", label: "Сеть" },
  { id: "launcher", label: "Лаунчер" },
];

interface SettingsScreenProps {
  onBack: () => void;
  onOpenStore: () => void;
}

export function SettingsScreen({ onBack, onOpenStore }: SettingsScreenProps) {
  const [activeTab, setActiveTab] = useState<TabId>("library");
  const [theme, setThemeState] = useState<Theme>("system");
  const screenRef = useRef<HTMLDivElement>(null);

  useSpatialNavigation(screenRef);

  useEffect(() => {
    getTheme().then(setThemeState);
  }, []);

  // Геймпад/клавиатура должны иметь что-то в фокусе сразу, без предварительного Tab.
  useEffect(() => {
    const container = screenRef.current;
    if (!container) return;
    if (container.contains(document.activeElement)) return;
    container.querySelector<HTMLElement>("[data-nav]")?.focus();
  }, []);

  function handleThemeChange(next: Theme) {
    setThemeState(next);
    persistTheme(next).catch((err) => console.error("Не удалось сохранить тему:", err));
  }

  return (
    <div className={styles.screen} ref={screenRef}>
      <header className={styles.topBar}>
        <div className={styles.leftNav}>
          <img src={logo} alt="dlemu" className={styles.logo} />
          <nav className={styles.navTabs}>
            <button
              type="button"
              data-nav
              className={styles.navTab}
              onClick={onBack}
            >
              <Library size={24} />
              Библиотека
            </button>
            <button
              type="button"
              data-nav
              className={styles.navTab}
              onClick={onOpenStore}
            >
              <Store size={24} />
              Магазин
            </button>
            <span className={`${styles.navTab} ${styles.navTabActive}`}>
              <Settings size={24} />
              Настройки
            </span>
          </nav>
        </div>
      </header>

      <nav className={styles.tabs}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-nav
            className={activeTab === tab.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={styles.content}>
        {activeTab !== "emulator" && (
          <img src={controllerImg} alt="" className={styles.controllerBg} />
        )}
        {activeTab === "library" && <LibraryTab />}
        {activeTab === "metadata" && <MetadataTab />}
        {activeTab === "emulator" && <EmulatorTab />}
        {activeTab === "network" && <NetworkTab />}
        {activeTab === "launcher" && <LauncherTab theme={theme} onThemeChange={handleThemeChange} />}
      </div>
    </div>
  );
}
