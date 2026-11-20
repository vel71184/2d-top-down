import type { Direction } from "../engine/sprite";
import type { Database, Row, Slot } from "./data";
import { clampHpMp } from "./party";
import { GameState } from "./state";

/**
 * Save slots, stored on the device (localStorage; inside the Android app this
 * lives in the app's private storage and survives updates, but not uninstalling).
 */
export const SAVE_SLOTS = 3;
const VERSION = 1;
const key = (slot: number) => `top-down-rpg.save.${slot}`;

export interface SaveData {
  version: number;
  savedAt: number;
  playTime: number;
  map: string;
  x: number;
  y: number;
  facing: Direction;
  party: { id: string; level: number; xp: number; hp: number; mp: number; equip: Partial<Record<Slot, string | null>>; row?: Row }[];
  inventory: [string, number][];
  gold: number;
  flags: string[];
}

export interface Position {
  map: string;
  x: number;
  y: number;
  facing: Direction;
}

export function makeSave(state: GameState, pos: Position): SaveData {
  return {
    version: VERSION,
    savedAt: Date.now(),
    playTime: Math.floor(state.playTime),
    ...pos,
    party: state.party.map((m) => ({ id: m.id, level: m.level, xp: m.xp, hp: m.hp, mp: m.mp, equip: { ...m.equip }, row: m.row })),
    inventory: [...state.inventory],
    gold: state.gold,
    flags: [...state.flags],
  };
}

export function writeSave(slot: number, data: SaveData): boolean {
  try {
    localStorage.setItem(key(slot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function readSave(slot: number): SaveData | null {
  try {
    const raw = localStorage.getItem(key(slot));
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    return d && d.version === VERSION && Array.isArray(d.party) ? d : null;
  } catch {
    return null;
  }
}

/** The most recently saved slot, or null if there are no saves. */
export function latestSlot(): number | null {
  let best: number | null = null, bestTime = -1;
  for (let i = 0; i < SAVE_SLOTS; i++) {
    const d = readSave(i);
    if (d && d.savedAt > bestTime) {
      best = i;
      bestTime = d.savedAt;
    }
  }
  return best;
}

/** Rebuilds the game state from a save. Anything no longer in the data files is skipped. */
export function loadState(db: Database, d: SaveData): GameState {
  const s = new GameState();
  for (const p of d.party) {
    const def = db.characters[p.id];
    if (!def) continue;
    const equip: Partial<Record<Slot, string | null>> = {};
    for (const [slot, id] of Object.entries(p.equip ?? {})) if (id && db.equipment[id]) equip[slot as Slot] = id;
    const row: Row = p.row === "back" || p.row === "front" ? p.row : def.row ?? "front";
    const m = { id: p.id, def, level: p.level, xp: p.xp, hp: p.hp, mp: p.mp, equip, row };
    clampHpMp(db, m);
    s.party.push(m);
  }
  if (s.party.length === 0) return GameState.newGame(db);
  for (const [id, n] of d.inventory) if ((db.items[id] || db.equipment[id]) && n > 0) s.inventory.set(id, n);
  s.gold = d.gold;
  s.flags = new Set(d.flags);
  s.playTime = d.playTime;
  return s;
}

export function formatPlayTime(seconds: number): string {
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** One-line summary for slot lists, e.g. "Aren Lv 3 · Town · 1:05". */
export function describeSave(db: Database, d: SaveData): string {
  const lead = d.party[0];
  const name = db.characters[lead?.id]?.name ?? "?";
  const place = d.map.charAt(0).toUpperCase() + d.map.slice(1);
  return `${name} Lv ${lead?.level ?? 1} · ${place} · ${formatPlayTime(d.playTime)}`;
}
