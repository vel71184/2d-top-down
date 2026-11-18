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

export interface CharacterDef {
  name: string;
  /** Sprite sheet name in public/assets/sprites (without .json). */
  sprite: string;
  stats: Stats;
  skills: string[];
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
  /** The enemy picks one of these each turn, weighted at random. */
  actions: { skill: string; weight: number }[];
}

/** Relative to the user: "enemy" means the opposing side. */
export type TargetType = "enemy" | "all_enemies" | "ally" | "all_allies" | "self" | "ally_dead";

export interface SkillDef {
  name: string;
  type: "physical" | "magic" | "heal";
  power: number;
  mp: number;
  target: TargetType;
  element?: string;
  desc?: string;
}

export interface ItemDef {
  name: string;
  desc: string;
  target: TargetType;
  effect: { hp?: number; mp?: number; revive?: number };
}

export interface Database {
  startingParty: string[];
  startingItems: Record<string, number>;
  characters: Record<string, CharacterDef>;
  enemies: Record<string, EnemyDef>;
  skills: Record<string, SkillDef>;
  items: Record<string, ItemDef>;
}

export async function loadDatabase(): Promise<Database> {
  const [chars, enemies, skills, items] = await Promise.all([
    loadJson<{ startingParty: string[]; startingItems: Record<string, number>; characters: Record<string, CharacterDef> }>(
      assetUrl("data/characters.json"),
    ),
    loadJson<Record<string, EnemyDef>>(assetUrl("data/enemies.json")),
    loadJson<Record<string, SkillDef>>(assetUrl("data/skills.json")),
    loadJson<Record<string, ItemDef>>(assetUrl("data/items.json")),
  ]);
  const db: Database = { ...chars, enemies, skills, items };
  validate(db);
  return db;
}

/** Catches typos in the data files early, with a readable message. */
function validate(db: Database): void {
  const problems: string[] = [];
  for (const id of db.startingParty) if (!db.characters[id]) problems.push(`startingParty: unknown character "${id}"`);
  for (const id of Object.keys(db.startingItems)) if (!db.items[id]) problems.push(`startingItems: unknown item "${id}"`);
  for (const [id, c] of Object.entries(db.characters))
    for (const s of c.skills) if (!db.skills[s]) problems.push(`character ${id}: unknown skill "${s}"`);
  for (const [id, e] of Object.entries(db.enemies))
    for (const a of e.actions) if (!db.skills[a.skill]) problems.push(`enemy ${id}: unknown skill "${a.skill}"`);
  if (problems.length) throw new Error("Data errors:\n" + problems.join("\n"));
}
