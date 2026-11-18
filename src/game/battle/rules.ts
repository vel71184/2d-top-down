import type { Database, ItemDef, SkillDef, TargetType } from "../data";
import type { Battler } from "./Battler";

/** What happened to one target, used to show numbers and effects. */
export interface Outcome {
  target: Battler;
  kind: "damage" | "heal" | "mp" | "revive" | "miss";
  amount: number;
  crit?: boolean;
  weak?: boolean;
  resist?: boolean;
}

const CRIT_CHANCE = 0.06;
const MISS_CHANCE = 0.04;

const variance = (): number => 0.9 + Math.random() * 0.2;

/**
 * Damage formulas. Tweak these to change how combat feels.
 *  physical: (ATK x 2 - DEF) x power%
 *  magic:    (MAG x 2 - DEF / 2) x power%
 *  heal:     (MAG x 2 + 10) x power%
 * Weakness x1.5, resistance x0.5, defending x0.5, critical x1.5.
 */
export function resolveSkill(user: Battler, skill: SkillDef, targets: Battler[]): Outcome[] {
  user.mp -= skill.mp;
  const out: Outcome[] = [];
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
    const weak = !!skill.element && !!t.enemy?.weak?.includes(skill.element);
    const resist = !!skill.element && !!t.enemy?.resist?.includes(skill.element);
    if (weak) base *= 1.5;
    if (resist) base *= 0.5;
    if (t.defending) base *= 0.5;
    const crit = skill.type === "physical" && Math.random() < CRIT_CHANCE;
    if (crit) base *= 1.5;
    const dmg = Math.max(1, Math.round(base));
    t.hp = Math.max(0, t.hp - dmg);
    out.push({ target: t, kind: "damage", amount: dmg, crit, weak, resist });
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

/** Valid targets for a target type, from the user's point of view. */
export function candidates(type: TargetType, user: Battler, all: Battler[]): Battler[] {
  const allies = all.filter((b) => b.side === user.side);
  const foes = all.filter((b) => b.side !== user.side);
  switch (type) {
    case "enemy":
    case "all_enemies":
      return foes.filter((b) => b.alive);
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

/** Simple enemy AI: weighted random action, random valid target. */
export function chooseEnemyAction(user: Battler, all: Battler[], db: Database): { skill: string; targets: Battler[] } | null {
  const options = (user.enemy?.actions ?? [{ skill: "attack", weight: 1 }]).filter((a) => (db.skills[a.skill]?.mp ?? 0) <= user.mp);
  const total = options.reduce((s, a) => s + a.weight, 0);
  let r = Math.random() * total;
  let pick = options[0];
  for (const a of options) {
    r -= a.weight;
    if (r <= 0) {
      pick = a;
      break;
    }
  }
  if (!pick) return null;
  const skill = db.skills[pick.skill];
  const pool = candidates(skill.target, user, all);
  if (pool.length === 0) return null;
  const targets = isMultiTarget(skill.target) ? pool : [pool[Math.floor(Math.random() * pool.length)]];
  return { skill: pick.skill, targets };
}
