// Вкладка «Лаунчер»: тема оформления + версия лаунчера внизу.
// См. docs/screens.md#2-settings-screen
import { useEffect, useState } from "react";
import { getLauncherVersion } from "../../api/launcher";
import type { Theme } from "../../types/settings";
import styles from "./LauncherTab.module.css";

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
  { value: "system", label: "Системная" },
];

interface LauncherTabProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
}

export function LauncherTab({ theme, onThemeChange }: LauncherTabProps) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getLauncherVersion().then(setVersion);
  }, []);

  // "light"/"dark" переопределяют системную тему явно (см. src/styles/index.css);
  // "system" снимает атрибут, и CSS сам следует prefers-color-scheme.
  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  return (
    <div>
      <h3 className={styles.sectionTitle}>Тема</h3>
      <div className={styles.options}>
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            data-nav
            className={theme === option.value ? `${styles.option} ${styles.optionActive}` : styles.option}
            onClick={() => onThemeChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className={styles.version}>Версия лаунчера: {version ?? "…"}</p>
    </div>
  );
}
