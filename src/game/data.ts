import { assetUrl, loadJson } from "../engine/assets";

/** Game content loaded from public/data/*.json. Edit those files to add or rebalance content. */

export interface Stats {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  mag: number;
  spd: number;
}

export type Slot = "weapon" | "armor" | "accessory";

/** Battle rows. Front row fights up close; back row is safer from melee. */
export type Row = "front" | "back";
/**
 * How far a physical attack reaches:
 *  melee  - halved from the back row, and halved against a back-row target
 *  reach  - (spears, whips) your own row doesn't matter; back-row targets still halved
 *  ranged - (bows) ignores rows completely
 * Magic and healing always ignore rows.
 */
export type Range = "melee" | "reach" | "ranged";
/** Which targets a skill hits around the one you pick. */
export type Area = "single" | "row" | "pierce";
export const SLOTS: Slot[] = ["weapon", "armor", "accessory"];

export interface CharacterDef {
  name: string;
  /** Sprite sheet name in public/assets/sprites (without .json). */
  sprite: string;
  /** Stats at level 1. */
  stats: Stats;
  /** Added per level (fractions add up over levels, e.g. 0.5 = +1 every 2 levels). */
  growth: Partial<Stats>;
  /** Skills known from the start. */
  skills: string[];
  /** Skills learned at a level: { "3": "ice" }. */
  learn?: Record<string, string>;
  /** Starting equipment. */
  equip?: Partial<Record<Slot, string>>;
  /** Starting battle row (default front). Change it in the menu's Formation screen. */
  row?: Row;
}

export interface EquipDef {
  name: string;
  slot: Slot;
  /** Stat bonuses while equipped. */
  stats: Partial<Stats>;
  price: number;
  /** Character ids who can equip it; omit for everyone. */
  users?: string[];
  /** Weapons only: attack range (default melee). */
  range?: Range;
  desc?: string;
}

export interface EnemyDef {
  name: string;
  /** Image in public/assets/enemies. */
  image: string;
  /** Art zoom in battle: each art pixel is drawn this many world pixels wide (default 2, same as the party). */
  scale?: number;
  stats: Stats;
  xp: number;
  gold: number;
  weak?: string[];
  resist?: string[];
  /** Battle row (default front). Override in a list with "name@back". */
  row?: Row;
  /** The enemy picks one of these each turn, weighted at random. */
  actions: { skill: string; weight: number }[];
}

/** Relative to the user: "enemy" means the opposing side. */
export type TargetType = "enemy" | "all_enemies" | "ally" | "all_allies" | "self" | "ally_dead";

export interface SkillDef {
  name: string;
  /** support: no damage, just an effect (e.g. cover). */
  type: "physical" | "magic" | "heal" | "support";
  power: number;
  mp: number;
  target: TargetType;
  /** Physical only: "weapon" (default) uses the equipped weapon's range; enemies' default is melee. */
  range?: Range | "weapon";
  /** single (default), row (everyone in the picked target's row), pierce (the target and the one behind it). */
  area?: Area;
  /** Pushes front-row targets that are hit into the back row. */
  knockback?: boolean;
  /** Support effect: "cover" = take single-target physical hits aimed at back-row allies until your next turn. */
  effect?: "cover";
  element?: string;
  desc?: string;
}

export interface ItemDef {
  name: string;
  desc: string;
  price: number;
  target: TargetType;
  effect: { hp?: number; mp?: number; revive?: number };
}

/** A table of enemy groups that random encounters pick from (weighted). */
export interface EncounterTable {
  groups: { enemies: string[]; weight: number }[];
}

export interface Database {
  startingParty: string[];
  startingItems: Record<string, number>;
  startingGold?: number;
  characters: Record<string, CharacterDef>;
  enemies: Record<string, EnemyDef>;
  skills: Record<string, SkillDef>;
  items: Record<string, ItemDef>;
  encounters: Record<string, EncounterTable>;
  equipment: Record<string, EquipDef>;
}

/** Display name of anything that can be in the inventory (item or equipment). */
export function thingName(db: Database, id: string): string {
  return db.items[id]?.name ?? db.equipment[id]?.name ?? id;
}

/** Shop price of an item or piece of equipment. */
export function thingPrice(db: Database, id: string): number {
  return db.items[id]?.price ?? db.equipment[id]?.price ?? 0;
}

export async function loadDatabase(): Promise<Database> {
  const [chars, enemies, skills, items, encounters, equipment] = await Promise.all([
    loadJson<{ startingParty: string[]; startingItems: Record<string, number>; startingGold?: number; characters: Record<string, CharacterDef> }>(
      assetUrl("data/characters.json"),
    ),
    loadJson<Record<string, EnemyDef>>(assetUrl("data/enemies.json")),
    loadJson<Record<string, SkillDef>>(assetUrl("data/skills.json")),
    loadJson<Record<string, ItemDef>>(assetUrl("data/items.json")),
    loadJson<Record<string, EncounterTable>>(assetUrl("data/encounters.json")),
    loadJson<Record<string, EquipDef>>(assetUrl("data/equipment.json")),
  ]);
  const db: Database = { ...chars, enemies, skills, items, encounters, equipment };
  validate(db);
  return db;
}

/** Catches typos in the data files early, with a readable message. */
function validate(db: Database): void {
  const problems: string[] = [];
  for (const id of db.startingParty) if (!db.characters[id]) problems.push(`startingParty: unknown character "${id}"`);
  for (const id of Object.keys(db.startingItems))
    if (!db.items[id] && !db.equipment[id]) problems.push(`startingItems: unknown item "${id}"`);
  for (const id of Object.keys(db.equipment)) if (db.items[id]) problems.push(`"${id}" is both an item and equipment`);
  for (const [id, c] of Object.entries(db.characters)) {
    for (const s of [...c.skills, ...Object.values(c.learn ?? {})]) if (!db.skills[s]) problems.push(`character ${id}: unknown skill "${s}"`);
    for (const [slot, e] of Object.entries(c.equip ?? {})) {
      if (!db.equipment[e]) problems.push(`character ${id}: unknown equipment "${e}"`);
      else if (db.equipment[e].slot !== slot) problems.push(`character ${id}: "${e}" is not a ${slot}`);
    }
  }
  const RANGES = ["melee", "reach", "ranged"], AREAS = ["single", "row", "pierce"], ROWS = ["front", "back"];
  for (const [id, s] of Object.entries(db.skills)) {
    if (s.range && s.range !== "weapon" && !RANGES.includes(s.range)) problems.push(`skill ${id}: range must be weapon, melee, reach or ranged`);
    if (s.area && !AREAS.includes(s.area)) problems.push(`skill ${id}: area must be single, row or pierce`);
  }
  for (const [id, c] of Object.entries(db.characters)) if (c.row && !ROWS.includes(c.row)) problems.push(`character ${id}: row must be front or back`);
  for (const [id, e] of Object.entries(db.enemies)) if (e.row && !ROWS.includes(e.row)) problems.push(`enemy ${id}: row must be front or back`);
  for (const [id, e] of Object.entries(db.equipment)) {
    if (e.range && !RANGES.includes(e.range)) problems.push(`equipment ${id}: range must be melee, reach or ranged`);
    if (!SLOTS.includes(e.slot)) problems.push(`equipment ${id}: slot must be weapon, armor or accessory`);
    for (const u of e.users ?? []) if (!db.characters[u]) problems.push(`equipment ${id}: unknown user "${u}"`);
  }
  for (const [id, e] of Object.entries(db.enemies))
    for (const a of e.actions) if (!db.skills[a.skill]) problems.push(`enemy ${id}: unknown skill "${a.skill}"`);
  for (const [id, t] of Object.entries(db.encounters))
    for (const g of t.groups) for (const e of g.enemies) if (!db.enemies[parseEnemyRef(e).id]) problems.push(`encounter table ${id}: unknown enemy "${e}"`);
  if (problems.length) throw new Error("Data errors:\n" + problems.join("\n"));
}

/** Parses an enemy reference like "goblin" or "goblin@back". */
export function parseEnemyRef(ref: string): { id: string; row?: Row } {
  const [id, row] = ref.trim().split("@");
  return { id, row: row === "front" || row === "back" ? row : undefined };
}
