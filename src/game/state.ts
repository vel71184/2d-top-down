import type { CharacterDef, Database, Row, Slot } from "./data";
import { memberStats } from "./party";

/** A character in the player's party, with their current condition. */
export interface PartyMember {
  id: string;
  def: CharacterDef;
  level: number;
  /** Total XP earned. */
  xp: number;
  hp: number;
  mp: number;
  equip: Partial<Record<Slot, string | null>>;
  /** Battle row (set in the menu's Formation screen). */
  row: Row;
}

/** Everything that changes as you play. This is what gets saved (see save.ts). */
export class GameState {
  party: PartyMember[] = [];
  /** Items and spare (unequipped) equipment, by id. */
  inventory = new Map<string, number>();
  gold = 0;
  /** Story/world flags, e.g. "defeated:town:12" for a beaten map enemy. */
  flags = new Set<string>();
  /** Seconds played. */
  playTime = 0;

  static newGame(db: Database): GameState {
    const s = new GameState();
    s.party = db.startingParty.map((id) => {
      const def = db.characters[id];
      const m: PartyMember = { id, def, level: 1, xp: 0, hp: 0, mp: 0, equip: { ...def.equip }, row: def.row ?? "front" };
      const st = memberStats(db, m);
      m.hp = st.hp;
      m.mp = st.mp;
      return m;
    });
    for (const [id, n] of Object.entries(db.startingItems)) s.inventory.set(id, n);
    s.gold = db.startingGold ?? 0;
    return s;
  }

  itemCount(id: string): number {
    return this.inventory.get(id) ?? 0;
  }

  addItem(id: string, n = 1): void {
    this.inventory.set(id, this.itemCount(id) + n);
  }

  useItem(id: string): void {
    const n = this.itemCount(id) - 1;
    if (n > 0) this.inventory.set(id, n);
    else this.inventory.delete(id);
  }

  /** Full HP/MP and revive everyone (inns). */
  restoreParty(db: Database): void {
    for (const m of this.party) {
      const st = memberStats(db, m);
      m.hp = st.hp;
      m.mp = st.mp;
    }
  }
}
