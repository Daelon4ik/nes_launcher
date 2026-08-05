import { useState, useEffect } from "react";
import { getSavedControls, saveControls, ActionName, DEFAULT_CONTROLS } from "../../utils/keyboardControls";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from "lucide-react";
import styles from "./EmulatorTab.module.css";

const getGamepadIcon = (id: ActionName) => {
  switch (id) {
    case "UP": return <div className={styles.dpadBtn}><ArrowUp size={16} /></div>;
    case "DOWN": return <div className={styles.dpadBtn}><ArrowDown size={16} /></div>;
    case "LEFT": return <div className={styles.dpadBtn}><ArrowLeft size={16} /></div>;
    case "RIGHT": return <div className={styles.dpadBtn}><ArrowRight size={16} /></div>;
    case "A": return <div className={styles.roundBtn} style={{ background: '#e74c3c' }}>A</div>;
    case "B": return <div className={styles.roundBtn} style={{ background: '#f1c40f', color: '#000' }}>B</div>;
    case "SELECT": return <div className={styles.pillBtn}>Sel</div>;
    case "START": return <div className={styles.pillBtn}>Start</div>;
    default: return null;
  }
};

export function EmulatorTab() {
  const [controls, setControls] = useState(getSavedControls);
  const [listeningFor, setListeningFor] = useState<{ player: "player1" | "player2"; action: ActionName } | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<"keyboard" | "gamepad">("keyboard");

  useEffect(() => {
    if (!listeningFor) return;

    function handleKeyDown(e: KeyboardEvent) {
      e.preventDefault();
      e.stopPropagation();

      const newBinding = {
        keyCode: e.keyCode,
        code: e.code,
        name: e.code.startsWith("Key") ? e.code.replace("Key", "") : 
              e.code.startsWith("Arrow") ? e.code.replace("Arrow", "") : 
              e.key === " " ? "Space" : e.key,
      };

      const { player, action } = listeningFor!;
      setControls((prev) => {
        const next = { ...prev, [player]: { ...prev[player], [action]: newBinding } };
        saveControls(next);
        return next;
      });
      setListeningFor(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [listeningFor]);

  const actions: { id: ActionName; label: string }[] = [
    { id: "UP", label: "Вверх" },
    { id: "DOWN", label: "Вниз" },
    { id: "LEFT", label: "Влево" },
    { id: "RIGHT", label: "Вправо" },
    { id: "A", label: "Кнопка A" },
    { id: "B", label: "Кнопка B" },
    { id: "SELECT", label: "Select" },
    { id: "START", label: "Start" },
  ];



  return (
    <div className={styles.container}>
      <h2>Настройка управления</h2>
      
      <div className={styles.tabs}>
        <button 
          type="button"
          className={`${styles.tabButton} ${activeTab === 'keyboard' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('keyboard')}
        >
          Клавиатура
        </button>
        <button 
          type="button"
          className={`${styles.tabButton} ${activeTab === 'gamepad' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('gamepad')}
        >
          Контроллер
        </button>
      </div>
      {activeTab === 'keyboard' ? (
        <div className={styles.players}>
          <div className={styles.playerColumn}>
            <h3>Игрок 1</h3>
            {actions.map((a) => (
              <div key={a.id} className={styles.keyRow}>
                <span>{a.label}</span>
                <button
                  type="button"
                  className={`${styles.keyButton} ${
                    listeningFor?.player === "player1" && listeningFor.action === a.id ? styles.listening : ""
                  }`}
                  onClick={() => setListeningFor({ player: "player1", action: a.id })}
                >
                  {listeningFor?.player === "player1" && listeningFor.action === a.id
                    ? "Нажмите..."
                    : controls.player1[a.id].name}
                </button>
              </div>
            ))}
          </div>
          <div className={styles.playerColumn}>
            <h3>Игрок 2</h3>
            {actions.map((a) => (
              <div key={a.id} className={styles.keyRow}>
                <span>{a.label}</span>
                <button
                  type="button"
                  className={`${styles.keyButton} ${
                    listeningFor?.player === "player2" && listeningFor.action === a.id ? styles.listening : ""
                  }`}
                  onClick={() => setListeningFor({ player: "player2", action: a.id })}
                >
                  {listeningFor?.player === "player2" && listeningFor.action === a.id
                    ? "Нажмите..."
                    : controls.player2[a.id].name}
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.players}>
          <div className={styles.playerColumn}>
            <h3>Игрок 1</h3>
            {actions.map((a) => (
              <div key={a.id} className={styles.keyRow}>
                <span>{a.label}</span>
                <button type="button" className={styles.keyButton} disabled>
                  <div className={styles.gamepadIconWrapper}>
                    {getGamepadIcon(a.id)}
                  </div>
                </button>
              </div>
            ))}
          </div>
          <div className={styles.playerColumn}>
            <h3>Игрок 2</h3>
            {actions.map((a) => (
              <div key={a.id} className={styles.keyRow}>
                <span>{a.label}</span>
                <button type="button" className={styles.keyButton} disabled>
                  <div className={styles.gamepadIconWrapper}>
                    {getGamepadIcon(a.id)}
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className={styles.resetButton}
        onClick={() => {
          setControls(DEFAULT_CONTROLS);
          saveControls(DEFAULT_CONTROLS);
        }}
      >
        Сбросить по умолчанию
      </button>

      <div className={styles.placeholderSection}>
        <div>
          <div className={styles.label}>Слоты сохранений</div>
          <div className={styles.value}>Save state</div>
        </div>
        <span className={styles.badge}>Скоро</span>
      </div>
    </div>
  );
}
