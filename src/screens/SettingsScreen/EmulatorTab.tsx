// Вкладка «Эмулятор»: управление, скорость, save state slots — пока заглушка,
// само эмулятор-ядро ещё не встроено. См. docs/screens.md#2-settings-screen
import styles from "./PlaceholderTab.module.css";

export function EmulatorTab() {
  return (
    <div>
      <div className={styles.row}>
        <div>
          <div className={styles.label}>Управление</div>
          <div className={styles.value}>Клавиатура / геймпад</div>
        </div>
        <span className={styles.badge}>Скоро</span>
      </div>

      <div className={styles.row}>
        <div>
          <div className={styles.label}>Слоты сохранений</div>
          <div className={styles.value}>Save state</div>
        </div>
        <span className={styles.badge}>Скоро</span>
      </div>
    </div>
  );
}
