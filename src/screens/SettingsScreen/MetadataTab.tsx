// Вкладка «Метаданные»: источник описаний/обложек. Пока только отображение —
// сам скрапер (src-tauri/src/metadata) ещё не реализован.
// См. docs/screens.md#2-settings-screen
import styles from "./PlaceholderTab.module.css";

export function MetadataTab() {
  return (
    <div>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Источник метаданных</div>
          <div className={styles.value}>emu-land.net</div>
        </div>
        <span className={styles.badge}>Скоро</span>
      </div>

      <button type="button" className={styles.disabledButton} disabled>
        Обновить метаданные для игры
      </button>
    </div>
  );
}
