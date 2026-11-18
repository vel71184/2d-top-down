import { padSettings } from "../engine/gamepad";
import { battleSettings, type AtbMode } from "./battle/BattleScene";

/** Player preferences, remembered on this device. */
interface SavedSettings {
  atbMode?: AtbMode;
  swapConfirmCancel?: boolean;
}

const KEY = "top-down-rpg.settings";

export function loadSettings(): void {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as SavedSettings;
    if (s.atbMode === "wait" || s.atbMode === "active") battleSettings.atbMode = s.atbMode;
    // The ?nintendo URL option wins over the saved choice.
    if (typeof s.swapConfirmCancel === "boolean" && !new URLSearchParams(location.search).has("nintendo")) {
      padSettings.swapConfirmCancel = s.swapConfirmCancel;
    }
  } catch {
    // Storage unavailable (private mode etc.): keep defaults.
  }
}

export function saveSettings(): void {
  try {
    const s: SavedSettings = { atbMode: battleSettings.atbMode, swapConfirmCancel: padSettings.swapConfirmCancel };
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
