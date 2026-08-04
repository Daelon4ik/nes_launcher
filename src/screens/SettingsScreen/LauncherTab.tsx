// Вкладка «Лаунчер»: тема оформления + версия лаунчера внизу.
// См. docs/screens.md#2-settings-screen
import { useEffect, useState } from "react";
import { getLauncherVersion } from "../../api/launcher";
import type { Theme } from "../../types/settings";

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
      <h3>Тема</h3>
      {THEME_OPTIONS.map((option) => (
        <label key={option.value}>
          <input
            type="radio"
            name="theme"
            checked={theme === option.value}
            onChange={() => onThemeChange(option.value)}
          />
          {option.label}
        </label>
      ))}

      <footer>Версия лаунчера: {version ?? "…"}</footer>
    </div>
  );
}
