import { SLOTS, type Database, type EquipDef, type Stats } from "./data";
import type { PartyMember } from "./state";

/** Progression rules: levels, stat growth, learned skills and equipment bonuses. */

export const MAX_LEVEL = 99;
const STAT_KEYS: (keyof Stats)[] = ["hp", "mp", "atk", "def", "mag", "spd"];

/** XP needed to go from `level` to `level + 1`. */
export function xpForNext(level: number): number {
  return Math.round(18 * Math.pow(level, 1.5));
}

/** Total XP needed to reach `level`. */
export function totalXpFor(level: number): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpForNext(l);
  return t;
}

/** Stats from level alone (no equipment). */
export function baseStats(db: Database, m: PartyMember): Stats {
  const def = db.characters[m.id];
  const out = { ...def.stats };
  for (const k of STAT_KEYS) out[k] = Math.floor(def.stats[k] + (def.growth?.[k] ?? 0) * (m.level - 1));
  return out;
}

/** Stats including equipment: what's used in battle and shown in menus. */
export function memberStats(db: Database, m: PartyMember, equipOverride?: Partial<Record<string, string | null>>): Stats {
  const out = baseStats(db, m);
  const equip = { ...m.equip, ...equipOverride };
  for (const slot of SLOTS) {
    const id = equip[slot];
    const e = id ? db.equipment[id] : undefined;
    if (!e) continue;
    for (const k of STAT_KEYS) out[k] += e.stats[k] ?? 0;
  }
  for (const k of STAT_KEYS) out[k] = Math.max(k === "hp" ? 1 : 0, out[k]);
  return out;
}

/** Skills known at the member's current level. */
export function skillsOf(db: Database, m: PartyMember): string[] {
  const def = db.characters[m.id];
  const learned = Object.entries(def.learn ?? {})
    .filter(([lvl]) => Number(lvl) <= m.level)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, s]) => s);
  return [...new Set([...def.skills, ...learned])];
}

export function canEquip(e: EquipDef, memberId: string): boolean {
  return !e.users || e.users.includes(memberId);
}

/** Keeps HP/MP within the (possibly changed) maximums. */
export function clampHpMp(db: Database, m: PartyMember): void {
  const s = memberStats(db, m);
  m.hp = Math.min(m.hp, s.hp);
  m.mp = Math.min(m.mp, s.mp);
}

/**
 * Adds XP and applies any level-ups. HP/MP grow along with their maximums.
 * Returns messages for the victory screen.
 */
export function gainXp(db: Database, m: PartyMember, amount: number): string[] {
  const msgs: string[] = [];
  if (m.hp <= 0) return msgs; // fallen members get nothing
  m.xp += amount;
  while (m.level < MAX_LEVEL && m.xp >= totalXpFor(m.level + 1)) {
    const before = memberStats(db, m);
    const skillsBefore = skillsOf(db, m);
    m.level++;
    const after = memberStats(db, m);
    m.hp += after.hp - before.hp;
    m.mp += after.mp - before.mp;
    const name = db.characters[m.id].name;
    msgs.push(`${name} reached Lv ${m.level}!`);
    for (const s of skillsOf(db, m)) if (!skillsBefore.includes(s)) msgs.push(`${name} learned ${db.skills[s].name}!`);
  }
  return msgs;
}
