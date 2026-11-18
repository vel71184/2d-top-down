import type { CharacterDef, Database } from "./data";

/** A character in the player's party, with their current condition. */
export interface PartyMember {
  id: string;
  def: CharacterDef;
  level: number;
  xp: number;
  hp: number;
  mp: number;
}

/** Everything that changes as you play (this is what will be saved in stage 4). */
export class GameState {
  party: PartyMember[] = [];
  inventory = new Map<string, number>();
  gold = 0;
  /** Story/world flags, e.g. "defeated:town:12" for a beaten map enemy. Saved with the game (stage 4). */
  flags = new Set<string>();

  static newGame(db: Database): GameState {
    const s = new GameState();
    s.party = db.startingParty.map((id) => {
      const def = db.characters[id];
      return { id, def, level: 1, xp: 0, hp: def.stats.hp, mp: def.stats.mp };
    });
    for (const [id, n] of Object.entries(db.startingItems)) s.inventory.set(id, n);
    return s;
  }

  itemCount(id: string): number {
    return this.inventory.get(id) ?? 0;
  }

  useItem(id: string): void {
    const n = this.itemCount(id) - 1;
    if (n > 0) this.inventory.set(id, n);
    else this.inventory.delete(id);
  }

  /** Full HP/MP and revive everyone (inns, defeat for now). */
  restoreParty(): void {
    for (const m of this.party) {
      m.hp = m.def.stats.hp;
      m.mp = m.def.stats.mp;
    }
  }
}
