// Вкладка «Сеть»: настройки P2P-кооп режима (см. docs/netplay.md). Обнаружение
// хостов в LAN автоматическое — руками указывать IP/порт партнёра не нужно,
// здесь только то, что видит партнёр (имя) и на чём слушает хост (порт).
// См. docs/screens.md#2-settings-screen
import { useEffect, useState } from "react";
import {
  getNetworkDisplayName,
  getNetworkHostPort,
  setNetworkDisplayName,
  setNetworkHostPort,
} from "../../api/settings";
import styles from "./NetworkTab.module.css";

export function NetworkTab() {
  const [displayName, setDisplayName] = useState("");
  const [port, setPort] = useState("");
  const [portError, setPortError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getNetworkDisplayName(), getNetworkHostPort()])
      .then(([name, hostPort]) => {
        setDisplayName(name);
        setPort(String(hostPort));
      })
      .finally(() => setLoaded(true));
  }, []);

  function handleNameBlur() {
    const trimmed = displayName.trim();
    if (!trimmed) {
      getNetworkDisplayName().then(setDisplayName);
      return;
    }
    setDisplayName(trimmed);
    setNetworkDisplayName(trimmed).catch((err) => console.error("Не удалось сохранить имя:", err));
  }

  function handlePortBlur() {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      setPortError(true);
      return;
    }
    setPortError(false);
    setNetworkHostPort(parsed).catch((err) => console.error("Не удалось сохранить порт:", err));
  }

  if (!loaded) return null;

  return (
    <div>
      <p className={styles.hint}>
        Имя видно партнёру при поиске и подключении к кооп-игре. Порт хоста — на
        нём лаунчер ждёт входящее подключение в режиме хоста; менять нужно
        только при конфликте с другой программой.
      </p>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="network-display-name">
          Имя игрока
        </label>
        <input
          id="network-display-name"
          type="text"
          data-nav
          className={styles.input}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onBlur={handleNameBlur}
          maxLength={32}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="network-host-port">
          Порт хоста
        </label>
        <input
          id="network-host-port"
          type="number"
          data-nav
          className={styles.input}
          value={port}
          min={1}
          max={65535}
          onChange={(e) => {
            setPort(e.target.value);
            setPortError(false);
          }}
          onBlur={handlePortBlur}
        />
        {portError && <p className={styles.error}>Порт должен быть числом от 1 до 65535.</p>}
      </div>
    </div>
  );
}
