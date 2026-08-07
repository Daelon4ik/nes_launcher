import { useState, useEffect } from "react";
import { getSavedControls, saveControls, ActionName, DEFAULT_CONTROLS } from "../../utils/keyboardControls";
import {
  getSavedGamepadControls,
  saveGamepadControls,
  describeGamepadButton,
  DEFAULT_GAMEPAD_CONTROLS,
} from "../../utils/jsnesGamepad";
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

import { getVolume, setVolume } from "../../api/settings";

export function EmulatorTab() {
  const [controls, setControls] = useState(getSavedControls);
  const [listeningFor, setListeningFor] = useState<{ player: "player1" | "player2"; action: ActionName } | null>(
    null,
  );
  const [gamepadControls, setGamepadControls] = useState(getSavedGamepadControls);
  const [listeningForGamepad, setListeningForGamepad] = useState<{
    player: "player1" | "player2";
    action: ActionName;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"keyboard" | "gamepad">("keyboard");
  const [volume, setVolumeState] = useState(1.0);

  useEffect(() => {
    getVolume().then(setVolumeState);
  }, []);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolumeState(newVol);
    setVolume(newVol).catch((err) => console.error("Failed to save volume", err));
  };

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

  // Ждём следующее НОВОЕ нажатие кнопки геймпада (опросом Gamepad API — событий
  // подключения кнопок в вебе нет), а не первую попавшуюся, чтобы не ловить кнопку,
  // уже зажатую с предыдущего действия. Слушаем геймпад того слота, который сейчас
  // переназначается (первый подключённый — Игрок 1, второй — Игрок 2); если для
  // этого слота геймпад ещё не подключён, используем первый доступный.
  useEffect(() => {
    if (!listeningForGamepad) return;
    const { player, action } = listeningForGamepad;

    const padIndex = player === "player1" ? 0 : 1;
    let wasPressed: boolean[] | null = null;
    let rafId: number;

    function poll() {
      const pads = Array.from(navigator.getGamepads()).filter((p): p is Gamepad => p !== null);
      const pad = pads[padIndex] ?? pads[0];
      if (!pad) {
        rafId = requestAnimationFrame(poll);
        return;
      }

      if (!wasPressed) {
        // Первый кадр после входа в режим ожидания — просто снимок текущего
        // состояния, чтобы не среагировать на уже зажатую кнопку.
        wasPressed = pad.buttons.map((b) => b.pressed);
        rafId = requestAnimationFrame(poll);
        return;
      }

      const pressedIndex = pad.buttons.findIndex((b, i) => b.pressed && !wasPressed![i]);
      if (pressedIndex !== -1) {
        setGamepadControls((prev) => {
          const next = { ...prev, [player]: { ...prev[player], [action]: { buttonId: pressedIndex } } };
          saveGamepadControls(next);
          return next;
        });
        setListeningForGamepad(null);
        return;
      }

      wasPressed = pad.buttons.map((b) => b.pressed);
      rafId = requestAnimationFrame(poll);
    }
    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [listeningForGamepad]);

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
      <h2>Настройки эмулятора</h2>
      
      <div className={styles.volumeSection}>
        <div className={styles.volumeHeader}>
          <h3>Громкость</h3>
          <span className={styles.volumeValue}>{Math.round(volume * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={handleVolumeChange}
          className={styles.volumeSlider}
          data-nav
        />
      </div>

      <h3 style={{ marginTop: '24px' }}>Настройка управления</h3>
      
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
                <span className={styles.gamepadIconWrapper}>
                  {getGamepadIcon(a.id)}
                  {a.label}
                </span>
                <button
                  type="button"
                  className={`${styles.keyButton} ${
                    listeningForGamepad?.player === "player1" && listeningForGamepad.action === a.id
                      ? styles.listening
                      : ""
                  }`}
                  onClick={() => setListeningForGamepad({ player: "player1", action: a.id })}
                >
                  {listeningForGamepad?.player === "player1" && listeningForGamepad.action === a.id
                    ? "Нажмите кнопку..."
                    : describeGamepadButton(gamepadControls.player1[a.id].buttonId)}
                </button>
              </div>
            ))}
          </div>
          <div className={styles.playerColumn}>
            <h3>Игрок 2</h3>
            {actions.map((a) => (
              <div key={a.id} className={styles.keyRow}>
                <span className={styles.gamepadIconWrapper}>
                  {getGamepadIcon(a.id)}
                  {a.label}
                </span>
                <button
                  type="button"
                  className={`${styles.keyButton} ${
                    listeningForGamepad?.player === "player2" && listeningForGamepad.action === a.id
                      ? styles.listening
                      : ""
                  }`}
                  onClick={() => setListeningForGamepad({ player: "player2", action: a.id })}
                >
                  {listeningForGamepad?.player === "player2" && listeningForGamepad.action === a.id
                    ? "Нажмите кнопку..."
                    : describeGamepadButton(gamepadControls.player2[a.id].buttonId)}
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
          if (activeTab === "keyboard") {
            setControls(DEFAULT_CONTROLS);
            saveControls(DEFAULT_CONTROLS);
          } else {
            setGamepadControls(DEFAULT_GAMEPAD_CONTROLS);
            saveGamepadControls(DEFAULT_GAMEPAD_CONTROLS);
          }
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
