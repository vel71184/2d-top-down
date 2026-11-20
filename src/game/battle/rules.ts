import type { Area, Database, ItemDef, Range, Row, SkillDef, TargetType } from "../data";
import type { Battler } from "./Battler";

/** What happened to one target, used to show numbers and effects. */
export interface Outcome {
  target: Battler;
  kind: "damage" | "heal" | "mp" | "revive" | "miss" | "status";
  amount: number;
  crit?: boolean;
  weak?: boolean;
  resist?: boolean;
  /** Damage was reduced by row distance. */
  far?: boolean;
  /** Target was pushed into the back row. */
  knockedBack?: boolean;
  /** For "status": short label to show (e.g. "Cover"). */
  label?: string;
}

const CRIT_CHANCE = 0.06;
const MISS_CHANCE = 0.04;
/** Damage multiplier for each "step" of row distance on a melee attack. */
const ROW_PENALTY = 0.5;

const variance = (): number => 0.9 + Math.random() * 0.2;

// ------------------------------------------------------------------ rows

/**
 * The row a battler effectively stands in: a back-row battler whose front
 * row has been wiped out is exposed and counts as front.
 */
export function effectiveRow(b: Battler, all: Battler[]): Row {
  if (b.row === "front") return "front";
  const frontAlive = all.some((o) => o.side === b.side && o !== b && o.alive && o.row === "front");
  return frontAlive ? "back" : "front";
}

/** Attack range of a skill used by `user` (null for magic/heal/support, which ignore rows). */
export function rangeOf(user: Battler, skill: SkillDef): Range | null {
  if (skill.type !== "physical") return null;
  if (skill.range && skill.range !== "weapon") return skill.range;
  return user.weaponRange;
}

/**
 * Row rules for physical attacks:
 *  melee  - halved if the attacker is in the back row, halved if the target is
 *  reach  - attacker's row doesn't matter; back-row targets still halved
 *  ranged - rows don't matter
 */
export function rowMultiplier(user: Battler, target: Battler, range: Range | null, all: Battler[]): number {
  if (!range || range === "ranged") return 1;
  let m = 1;
  if (range === "melee" && user.row === "back") m *= ROW_PENALTY;
  if (effectiveRow(target, all) === "back") m *= ROW_PENALTY;
  return m;
}

/** Expands the picked target into everyone the skill's area hits. `pool` = valid targets. */
export function areaTargets(area: Area | undefined, primary: Battler, pool: Battler[]): Battler[] {
  if (!area || area === "single") return [primary];
  if (area === "row") return pool.filter((b) => b.row === primary.row);
  // pierce: the target, plus the one standing behind it (closest lane in the back row)
  if (primary.row === "back") return [primary];
  const behind = pool
    .filter((b) => b.row === "back")
    .sort((a, b) => Math.abs(a.lane - primary.lane) - Math.abs(b.lane - primary.lane))[0];
  return behind ? [primary, behind] : [primary];
}

// ------------------------------------------------------------ resolution

/**
 * Damage formulas. Tweak these to change how combat feels.
 *  physical: (ATK x 2 - DEF) x power%
 *  magic:    (MAG x 2 - DEF / 2) x power%
 *  heal:     (MAG x 2 + 10) x power%
 * Then: row distance (see rowMultiplier), weakness x1.5, resistance x0.5,
 * defending x0.5, critical x1.5.
 */
export function resolveSkill(user: Battler, skill: SkillDef, targets: Battler[], all: Battler[]): Outcome[] {
  user.mp -= skill.mp;
  const out: Outcome[] = [];

  if (skill.type === "support") {
    if (skill.effect === "cover") {
      user.covering = true;
      out.push({ target: user, kind: "status", amount: 0, label: "Cover" });
    }
    return out;
  }

  const range = rangeOf(user, skill);
  for (const t of targets) {
    if (skill.type === "heal") {
      if (!t.alive) continue;
      const amt = Math.round((user.stats.mag * 2 + 10) * (skill.power / 100) * variance());
      out.push({ target: t, kind: "heal", amount: applyHeal(t, amt) });
      continue;
    }
    if (!t.alive) continue;
    if (skill.type === "physical" && Math.random() < MISS_CHANCE) {
      out.push({ target: t, kind: "miss", amount: 0 });
      continue;
    }
    let base =
      skill.type === "physical"
        ? user.stats.atk * 2 - t.stats.def
        : user.stats.mag * 2 - t.stats.def / 2;
    base = Math.max(1, base) * (skill.power / 100) * variance();
    const rowMul = rowMultiplier(user, t, range, all);
    base *= rowMul;
    const weak = !!skill.element && !!t.enemy?.weak?.includes(skill.element);
    const resist = !!skill.element && !!t.enemy?.resist?.includes(skill.element);
    if (weak) base *= 1.5;
    if (resist) base *= 0.5;
    if (t.defending) base *= 0.5;
    const crit = skill.type === "physical" && Math.random() < CRIT_CHANCE;
    if (crit) base *= 1.5;
    const dmg = Math.max(1, Math.round(base));
    t.hp = Math.max(0, t.hp - dmg);
    let knockedBack = false;
    if (skill.knockback && t.alive && t.row === "front") {
      t.row = "back";
      knockedBack = true;
    }
    out.push({ target: t, kind: "damage", amount: dmg, crit, weak, resist, far: rowMul < 1, knockedBack });
  }
  return out;
}

export function resolveItem(item: ItemDef, targets: Battler[]): Outcome[] {
  const out: Outcome[] = [];
  for (const t of targets) {
    const e = item.effect;
    if (e.revive) {
      if (t.alive) continue;
      t.hp = Math.max(1, Math.round(t.stats.hp * e.revive));
      out.push({ target: t, kind: "revive", amount: t.hp });
      continue;
    }
    if (!t.alive) continue;
    if (e.hp) out.push({ target: t, kind: "heal", amount: applyHeal(t, e.hp) });
    if (e.mp) {
      const before = t.mp;
      t.mp = Math.min(t.stats.mp, t.mp + e.mp);
      out.push({ target: t, kind: "mp", amount: t.mp - before });
    }
  }
  return out;
}

function applyHeal(t: Battler, amount: number): number {
  const before = t.hp;
  t.hp = Math.min(t.stats.hp, t.hp + amount);
  return t.hp - before;
}

/**
 * Cover: a single-target physical attack on a back-row ally is taken by an
 * ally who is covering. Returns the coverer, or null.
 */
export function coverFor(target: Battler, skill: SkillDef, all: Battler[]): Battler | null {
  if (skill.type !== "physical" || (skill.area && skill.area !== "single")) return null;
  if (effectiveRow(target, all) !== "back") return null;
  return all.find((b) => b.side === target.side && b !== target && b.alive && b.covering) ?? null;
}

// ------------------------------------------------------------- targeting

/** Valid targets for a target type, from the user's point of view. */
export function candidates(type: TargetType, user: Battler, all: Battler[]): Battler[] {
  const allies = all.filter((b) => b.side === user.side);
  const foes = all.filter((b) => b.side !== user.side);
  switch (type) {
    case "enemy":
    case "all_enemies":
      // Front row first, then top to bottom, so the target cursor moves predictably.
      return foes.filter((b) => b.alive).sort((a, b) => (a.row === b.row ? a.lane - b.lane : a.row === "front" ? -1 : 1));
    case "ally":
    case "all_allies":
      return allies.filter((b) => b.alive);
    case "ally_dead":
      return allies.filter((b) => !b.alive);
    case "self":
      return [user];
  }
}

export const isMultiTarget = (type: TargetType): boolean => type === "all_enemies" || type === "all_allies";

/**
 * Simple enemy AI: weighted random action. Physical attacks that care about
 * rows prefer front-row targets (3:1).
 */
export function chooseEnemyAction(
  user: Battler,
  all: Battler[],
  db: Database,
): { skill: string; targets: Battler[]; primary: Battler } | null {
  const options = (user.enemy?.actions ?? [{ skill: "attack", weight: 1 }]).filter((a) => (db.skills[a.skill]?.mp ?? 0) <= user.mp);
  const pick = weighted(options, (a) => a.weight);
  if (!pick) return null;
  const skill = db.skills[pick.skill];
  const pool = candidates(skill.target, user, all);
  if (pool.length === 0) return null;
  if (isMultiTarget(skill.target)) return { skill: pick.skill, targets: pool, primary: pool[0] };
  const range = rangeOf(user, skill);
  const caresAboutRows = range === "melee" || range === "reach";
  const primary = weighted(pool, (b) => (caresAboutRows && effectiveRow(b, all) === "front" ? 3 : 1))!;
  return { skill: pick.skill, targets: areaTargets(skill.area, primary, pool), primary };
}

function weighted<T>(items: T[], weight: (t: T) => number): T | undefined {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = Math.random() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[0];
}
