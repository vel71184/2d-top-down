import { assetUrl, loadImage } from "../../engine/assets";
import { Scene } from "../../engine/scene";
import type { RPG } from "../context";
import { parseEnemyRef, type Area, type Row, type TargetType } from "../data";
import { gainXp, memberStats, skillsOf } from "../party";
import { Menu, type MenuItem } from "../ui/Menu";
import { COLORS, drawPanel, font, outlinedText } from "../ui/theme";
import { Battler } from "./Battler";
import {
  areaTargets, candidates, chooseEnemyAction, coverFor, isMultiTarget, resolveItem, resolveSkill, type Outcome,
} from "./rules";

export type BattleResult = "victory" | "defeat" | "fled";

export interface BattleOptions {
  /** Bosses and story fights can forbid running away. */
  canFlee?: boolean;
}

/**
 * "wait":   all turn gauges pause while you are choosing a command (relaxed, good on phones).
 * "active": gauges keep filling while you choose (enemies won't wait for you).
 */
export type AtbMode = "wait" | "active";
export const battleSettings: { atbMode: AtbMode } = { atbMode: "wait" };

type Action =
  /** `primary` is the target that was picked; `targets` adds whoever the skill's area also hits. */
  | { kind: "skill"; user: Battler; id: string; targets: Battler[]; primary?: Battler }
  | { kind: "item"; user: Battler; id: string; targets: Battler[]; primary?: Battler }
  | { kind: "row"; user: Battler }
  | { kind: "run"; user: Battler };

type Mode =
  | { m: "command" }
  | { m: "skill" }
  | { m: "item" }
  | {
      m: "target";
      type: TargetType;
      area?: Area;
      back: "command" | "skill" | "item";
      index: number;
      make: (targets: Battler[], primary: Battler) => Action;
    };

interface Popup { text: string; x: number; y: number; t: number; color: string; size: number }
interface Effect { kind: "slash" | "burst" | "sparkle"; x: number; y: number; t: number; color: string }

// Action animation timeline (seconds)
const STEP_OUT = 0.18;
const HIT_AT = 0.4;
const ACTION_END = 1.0;
const FADE_SPEED = 3;

const ELEMENT_COLORS: Record<string, string> = { fire: "#ff8a3a", ice: "#7fe0ff", thunder: "#fff06a" };

export class BattleScene extends Scene {
  private battlers: Battler[] = [];
  private ready: Battler[] = []; // party members waiting for your command
  private actions: Action[] = [];
  private current: { a: Action; t: number; hit: boolean } | null = null;
  private mode: Mode | null = null;
  private commandMenu: Menu | null = null;
  private listMenu: Menu | null = null;
  private listIds: string[] = [];

  private popups: Popup[] = [];
  private effects: Effect[] = [];
  private banner: { text: string; t: number } | null = null;
  private phase: "fight" | "result" | "outro" = "fight";
  private result: BattleResult = "victory";
  private resultLines: string[] = [];
  private fade = 1;
  private fadeDir: 1 | -1 = -1;
  private time = 0;
  private panelTop = 0;

  constructor(
    private rpg: RPG,
    private enemyIds: string[],
    private options: BattleOptions,
    private onEnd: (result: BattleResult) => void,
  ) {
    super(rpg.game);
  }

  private get party(): Battler[] {
    return this.battlers.filter((b) => b.side === "party");
  }
  private get enemies(): Battler[] {
    return this.battlers.filter((b) => b.side === "enemy");
  }

  async enter(): Promise<void> {
    const { db, state, sprites } = this.rpg;
    this.game.input.reset();

    state.party.forEach((m, i) => {
      const d = m.def;
      const stats = memberStats(db, m); // level + equipment
      const b = new Battler("party", d.name, stats, m.hp, m.mp, skillsOf(db, m), m, undefined, sprites.get(d.sprite));
      b.row = m.row;
      b.lane = i;
      const weapon = m.equip.weapon ? db.equipment[m.equip.weapon] : undefined;
      b.weaponRange = weapon?.range ?? "melee";
      this.battlers.push(b);
    });
    const refs = this.enemyIds.map(parseEnemyRef);
    const counts = new Map<string, number>();
    for (const { id } of refs) counts.set(id, (counts.get(id) ?? 0) + 1);
    const seen = new Map<string, number>();
    const lanes: Record<Row, number> = { front: 0, back: 0 };
    for (const ref of refs) {
      const id = ref.id;
      const def = db.enemies[id];
      if (!def) throw new Error(`Unknown enemy "${id}" (check public/data/enemies.json)`);
      const img = await loadImage(assetUrl(`assets/enemies/${def.image}`));
      // "Slime A", "Slime B" when there are several of the same kind.
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      const name = (counts.get(id) ?? 0) > 1 ? `${def.name} ${String.fromCharCode(64 + n)}` : def.name;
      const b = new Battler("enemy", name, def.stats, def.stats.hp, def.stats.mp, [], undefined, def, undefined, img);
      b.row = ref.row ?? def.row ?? "front";
      b.lane = lanes[b.row]++;
      this.battlers.push(b);
    }
    for (const b of this.battlers) b.worldScale = this.game.display.worldScale;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this.time += dt;
    this.rpg.state.playTime += dt;
    this.fade = Math.max(0, Math.min(1, this.fade + this.fadeDir * FADE_SPEED * dt));
    this.updateVisuals(dt);

    if (this.phase === "outro") {
      if (this.fade >= 1) this.finish();
      return;
    }
    if (this.phase === "result") {
      const input = this.game.input;
      if (input.pressed("confirm") || input.pressed("cancel")) this.startOutro();
      return;
    }
    if (this.fade > 0.5) return; // still fading in

    if (this.current) this.runCurrent(dt);
    else if (this.actions.length) this.startNext();
    if (this.phase !== "fight") return;

    // Drop fallen members from the command queue.
    const before = this.ready[0];
    this.ready = this.ready.filter((b) => b.alive);
    if (this.ready[0] !== before) this.openCommand();

    const choosing = this.ready.length > 0;
    if (!this.current && !(choosing && battleSettings.atbMode === "wait")) this.fillGauges(dt);
    if (this.ready.length && !this.mode) this.openCommand();
    if (this.mode) this.handleCommandInput();
  }

  private fillGauges(dt: number): void {
    for (const b of this.battlers) {
      if (!b.alive || b.queued || this.ready.includes(b)) continue;
      b.atb = Math.min(1, b.atb + b.fillRate * dt);
      if (b.atb < 1) continue;
      b.defending = false; // defending and cover last until your next turn
      b.covering = false;
      if (b.side === "party") {
        this.ready.push(b);
      } else {
        const choice = chooseEnemyAction(b, this.battlers, this.rpg.db);
        if (choice) {
          this.actions.push({ kind: "skill", user: b, id: choice.skill, targets: choice.targets, primary: choice.primary });
          b.queued = true;
        } else b.atb = 0;
      }
    }
  }

  private updateVisuals(dt: number): void {
    for (const b of this.battlers) {
      b.flash = Math.max(0, b.flash - dt);
      b.shake = Math.max(0, b.shake - dt * 3);
      // Glide to a new row
      if (Number.isNaN(b.visualX)) b.visualX = b.homeX;
      else b.visualX += (b.homeX - b.visualX) * Math.min(1, dt * 8);
      if (b.side === "enemy" && !b.alive) b.fade = Math.max(0, b.fade - dt * 2);
      else if (b.alive) b.fade = 1;
    }
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 1.0);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter((e) => e.t < 0.45);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.1) this.banner = null;
    }
  }

  // ------------------------------------------------------------- commands

  private openCommand(): void {
    const b = this.ready[0];
    this.listMenu = null;
    if (!b) {
      this.mode = null;
      this.commandMenu = null;
      return;
    }
    const hasItems = this.usableItems().length > 0;
    const items: MenuItem[] = [
      { label: "Attack" },
      { label: "Skill", disabled: b.skills.length === 0 },
      { label: "Item", disabled: !hasItems },
      { label: "Defend" },
      { label: "Row" },
      { label: "Run", disabled: this.options.canFlee === false },
    ];
    this.commandMenu = this.placeMenu(new Menu(items, 0, 0, 0, 0, 2, 22));
    this.mode = { m: "command" };
  }

  private handleCommandInput(): void {
    const user = this.ready[0];
    const mode = this.mode;
    if (!user || !mode) return;
    const input = this.game.input;
    const { db, state } = this.rpg;

    if (mode.m === "command" && this.commandMenu) {
      const r = this.commandMenu.update(input, false);
      if (r?.type !== "select") return;
      switch (r.index) {
        case 0:
          this.beginTarget("enemy", undefined, "command", (t, p) => ({ kind: "skill", user, id: "attack", targets: t, primary: p }));
          break;
        case 1:
          this.listIds = user.skills;
          this.listMenu = this.placeMenu(new Menu(
            user.skills.map((id) => {
              const s = db.skills[id];
              return { label: s.name, right: s.mp ? `${s.mp} MP` : "", disabled: s.mp > user.mp, help: s.desc };
            }),
            0, 0, 0, 0, 1, 17,
          ));
          this.mode = { m: "skill" };
          break;
        case 2:
          this.listIds = this.usableItems();
          this.listMenu = this.placeMenu(new Menu(
            this.listIds.map((id) => ({ label: db.items[id].name, right: `×${state.itemCount(id)}`, help: db.items[id].desc })),
            0, 0, 0, 0, 1, 17,
          ));
          this.mode = { m: "item" };
          break;
        case 3:
          // Defending is instant: halves damage until this character's next turn.
          user.defending = true;
          user.atb = 0;
          this.popup(user, "Defend", COLORS.mp, 10);
          this.ready.shift();
          this.openCommand();
          break;
        case 4:
          // Changing rows takes this character's turn.
          this.commit({ kind: "row", user });
          break;
        case 5:
          this.commit({ kind: "run", user });
          break;
      }
      return;
    }

    if ((mode.m === "skill" || mode.m === "item") && this.listMenu) {
      const r = this.listMenu.update(input, false);
      if (r?.type === "cancel") return this.openCommand();
      if (r?.type !== "select") return;
      const id = this.listIds[r.index];
      if (mode.m === "skill") {
        const skill = db.skills[id];
        this.beginTarget(skill.target, skill.area, "skill", (t, p) => ({ kind: "skill", user, id, targets: t, primary: p }));
      } else {
        const item = db.items[id];
        this.beginTarget(item.target, undefined, "item", (t, p) => ({ kind: "item", user, id, targets: t, primary: p }));
      }
      return;
    }

    if (mode.m === "target") {
      const pool = candidates(mode.type, user, this.battlers);
      if (pool.length === 0) return this.backFromTarget(mode.back);
      mode.index = Math.min(mode.index, pool.length - 1);
      if (input.pressed("cancel")) return this.backFromTarget(mode.back);
      const nav = input.nav();
      if (nav === "up" || nav === "left") mode.index = (mode.index - 1 + pool.length) % pool.length;
      if (nav === "down" || nav === "right") mode.index = (mode.index + 1) % pool.length;
      if (input.pressed("confirm")) this.commit(mode.make(this.pickedTargets(mode, pool), pool[mode.index]));
    }
  }

  /** Consumable items in the bag (equipment is managed in the menu). */
  private usableItems(): string[] {
    return [...this.rpg.state.inventory.keys()].filter((id) => this.rpg.db.items[id]);
  }

  /** Everyone hit if the current target choice is confirmed (all-targets, row and pierce included). */
  private pickedTargets(mode: Extract<Mode, { m: "target" }>, pool: Battler[]): Battler[] {
    if (isMultiTarget(mode.type)) return pool;
    const primary = pool[mode.index];
    return primary ? areaTargets(mode.area, primary, pool) : [];
  }

  private beginTarget(
    type: TargetType,
    area: Area | undefined,
    back: "command" | "skill" | "item",
    make: (t: Battler[], primary: Battler) => Action,
  ): void {
    const user = this.ready[0];
    if (type === "self") return this.commit(make([user], user));
    const pool = candidates(type, user, this.battlers);
    if (pool.length === 0) return; // nothing valid (e.g. no one to revive)
    // Healing defaults to the most hurt ally.
    let index = 0;
    if (type === "ally") index = pool.reduce((best, b, i) => (b.hp / b.stats.hp < pool[best].hp / pool[best].stats.hp ? i : best), 0);
    this.mode = { m: "target", type, area, back, index, make };
  }

  private backFromTarget(back: "command" | "skill" | "item"): void {
    if (back === "command") this.openCommand();
    else this.mode = { m: back };
  }

  private commit(a: Action): void {
    if (a.kind === "item") this.rpg.state.useItem(a.id); // reserve it now so two people can't use the last one
    a.user.queued = true;
    this.actions.push(a);
    this.ready.shift();
    this.openCommand();
  }

  // -------------------------------------------------------------- actions

  private startNext(): void {
    const a = this.actions.shift()!;
    if (!a.user.alive) {
      a.user.queued = false;
      return;
    }
    if (a.kind === "skill" || a.kind === "item") {
      const def = a.kind === "skill" ? this.rpg.db.skills[a.id] : this.rpg.db.items[a.id];
      const area = a.kind === "skill" ? this.rpg.db.skills[a.id].area : undefined;
      const pool = candidates(def.target, a.user, this.battlers);
      if (isMultiTarget(def.target)) a.targets = pool;
      else {
        // If the picked target fell, pick another; then re-apply the area (rows may have changed).
        let primary = a.primary && pool.includes(a.primary) ? a.primary : undefined;
        if (!primary && pool.length) primary = pool[Math.floor(Math.random() * pool.length)];
        a.targets = primary ? areaTargets(area, primary, pool) : [];
      }
      if (a.id !== "attack") this.banner = { text: def.name, t: 0 };
    } else {
      this.banner = { text: a.kind === "row" ? "Change Row" : "Run", t: 0 };
    }
    this.current = { a, t: 0, hit: false };
  }

  private runCurrent(dt: number): void {
    const c = this.current!;
    c.t += dt;
    const u = c.a.user;
    const dir = u.side === "party" ? -1 : 1;
    const out = Math.min(1, c.t / STEP_OUT);
    const back = Math.max(0, Math.min(1, (c.t - (ACTION_END - STEP_OUT)) / STEP_OUT));
    u.offsetX = dir * 16 * (out - back);
    if (u.side === "enemy" && c.t < HIT_AT) u.flash = 0.1;

    if (!c.hit && c.t >= HIT_AT) {
      c.hit = true;
      this.applyAction(c.a);
    }
    if (c.t >= ACTION_END) {
      u.offsetX = 0;
      u.atb = 0;
      u.queued = false;
      this.current = null;
      this.checkEnd();
    }
  }

  private applyAction(a: Action): void {
    const { db } = this.rpg;
    if (a.kind === "row") {
      a.user.row = a.user.row === "front" ? "back" : "front";
      if (a.user.side === "enemy") a.user.lane = this.nextLane(a.user.row);
      this.popup(a.user, a.user.row === "front" ? "Front row" : "Back row", COLORS.mp, 10);
      return;
    }
    if (a.kind === "run") {
      const avg = (bs: Battler[]) => bs.reduce((s, b) => s + b.stats.spd, 0) / Math.max(1, bs.length);
      const chance = Math.max(0.15, Math.min(0.95, 0.55 + (avg(this.party.filter((b) => b.alive)) - avg(this.enemies.filter((b) => b.alive))) * 0.03));
      if (Math.random() < chance) {
        this.banner = { text: "Escaped!", t: 0 };
        this.result = "fled";
        this.actions = [];
        this.ready = [];
        this.mode = null;
        this.phase = "outro";
        this.fadeDir = 1;
      } else {
        this.banner = { text: "Couldn't escape!", t: 0 };
      }
      return;
    }
    let outcomes: Outcome[];
    let color = "#ffffff";
    if (a.kind === "skill") {
      const skill = db.skills[a.id];
      // Cover: a covering ally steps in front of a back-row target.
      if (a.targets.length === 1) {
        const coverer = coverFor(a.targets[0], skill, this.battlers);
        if (coverer) {
          this.popup(coverer, "Cover!", COLORS.mp, 10, -14);
          a.targets = [coverer];
        }
      }
      outcomes = resolveSkill(a.user, skill, a.targets, this.battlers);
      color = skill.type === "heal" ? COLORS.heal : ELEMENT_COLORS[skill.element ?? ""] ?? (skill.type === "magic" ? "#c8a0ff" : "#ffffff");
      if (skill.type !== "support")
        for (const t of a.targets)
          this.effects.push({ kind: skill.type === "heal" ? "sparkle" : skill.type === "magic" ? "burst" : "slash", x: t.centerX, y: t.centerY, t: 0, color });
    } else {
      outcomes = resolveItem(db.items[a.id], a.targets);
      for (const t of a.targets) this.effects.push({ kind: "sparkle", x: t.centerX, y: t.centerY, t: 0, color: COLORS.heal });
    }
    for (const o of outcomes) {
      switch (o.kind) {
        case "damage":
          o.target.shake = 1;
          o.target.flash = 0.25;
          this.popup(o.target, String(o.amount), o.crit ? COLORS.accent : COLORS.damage, o.crit ? 15 : 13);
          if (o.weak) this.popup(o.target, "Weak!", "#ff9a5a", 9, -14);
          if (o.resist) this.popup(o.target, "Resist", COLORS.dim, 9, -14);
          if (o.crit) this.popup(o.target, "Critical!", COLORS.accent, 9, -14);
          else if (o.far) this.popup(o.target, "Too far", COLORS.dim, 9, -14);
          if (o.knockedBack) {
            o.target.lane = this.nextLane("back", o.target.side);
            this.popup(o.target, "Knocked back!", "#ff9a5a", 9, -26);
          }
          break;
        case "status":
          this.popup(o.target, o.label ?? "", COLORS.mp, 11);
          break;
        case "heal":
          this.popup(o.target, `+${o.amount}`, COLORS.heal, 13);
          break;
        case "mp":
          this.popup(o.target, `+${o.amount} MP`, COLORS.mp, 12);
          break;
        case "revive":
          this.popup(o.target, "Revived", COLORS.heal, 12);
          o.target.atb = 0;
          break;
        case "miss":
          this.popup(o.target, "Miss", COLORS.dim, 12);
          break;
      }
      if (!o.target.alive) {
        o.target.atb = 0;
        o.target.queued = false;
        this.actions = this.actions.filter((x) => x.user !== o.target);
      }
    }
  }

  /** A free lane at the end of a row (for battlers moving into it). */
  private nextLane(row: Row, side: "party" | "enemy" = "enemy"): number {
    const inRow = this.battlers.filter((b) => b.side === side && b.row === row);
    return inRow.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  }

  private checkEnd(): void {
    if (this.phase !== "fight") return;
    if (this.enemies.every((b) => !b.alive)) {
      const xp = this.enemies.reduce((s, b) => s + (b.enemy?.xp ?? 0), 0);
      const gold = this.enemies.reduce((s, b) => s + (b.enemy?.gold ?? 0), 0);
      this.rpg.state.gold += gold;
      const lines = ["Victory!", `Gained ${xp} XP  ·  Found ${gold} gold`];
      for (const b of this.party) {
        const m = b.member;
        if (!m) continue;
        // Sync HP/MP first so level-up gains are added on top, then copy back.
        m.hp = b.hp;
        m.mp = b.mp;
        lines.push(...gainXp(this.rpg.db, m, xp));
        b.stats = memberStats(this.rpg.db, m);
        b.hp = m.hp;
        b.mp = m.mp;
      }
      this.endWith("victory", lines);
    } else if (this.party.every((b) => !b.alive)) {
      this.endWith("defeat", ["Your party has fallen..."]);
    }
  }

  private endWith(result: BattleResult, lines: string[]): void {
    this.result = result;
    this.resultLines = lines;
    this.phase = "result";
    this.actions = [];
    this.ready = [];
    this.mode = null;
  }

  private startOutro(): void {
    this.phase = "outro";
    this.fadeDir = 1;
  }

  private finish(): void {
    for (const b of this.party) {
      if (!b.member) continue;
      b.member.hp = b.hp;
      b.member.mp = b.mp;
    }
    this.game.scenes.pop();
    this.onEnd(this.result);
  }

  private popup(b: Battler, text: string, color: string, size: number, dy = 0): void {
    this.popups.push({ text, x: b.centerX, y: b.homeY - b.size.h * 0.6 + dy, t: 0, color, size });
  }

  // --------------------------------------------------------------- render

  private layout(W: number, H: number): void {
    this.panelTop = H - 78;
    // Rows are columns: the front row stands nearer the middle of the screen.
    this.party.forEach((b) => {
      b.homeX = b.row === "front" ? W - 84 : W - 46;
      b.homeY = 66 + b.lane * 38;
    });
    const colW = Math.min(84, W * 0.18);
    for (const row of ["front", "back"] as const) {
      const inRow = this.enemies.filter((b) => b.row === row).sort((a, b) => a.lane - b.lane);
      const n = inRow.length;
      // Spread the row over the battlefield height (feet between y=70 and y=160).
      const spacing = n > 1 ? Math.min(62, 90 / (n - 1)) : 0;
      inRow.forEach((b, k) => {
        const x = W * 0.36 - (row === "back" ? colW : 0);
        // a slight zig-zag so neighbours overlap less
        b.homeX = Math.round(x + (k % 2 ? -8 : 8));
        b.homeY = Math.round(115 + (k - (n - 1) / 2) * spacing);
      });
    }
  }

  render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    // The battle is laid out in UI units; the world canvas is scaled to match.
    const d = this.game.display;
    const W = d.uiWidth, H = d.uiHeight;
    world.setTransform(d.worldScale, 0, 0, d.worldScale, 0, 0);
    this.layout(W, H);
    this.drawBackground(world, W, H);

    // Draw back-to-front so lower characters overlap higher ones.
    const order = [...this.battlers].sort((a, b) => a.homeY - b.homeY);
    for (const b of order) this.drawBattler(world, b);
    for (const e of this.effects) this.drawEffect(world, e);

    this.drawTargetCursor(ui);
    for (const p of this.popups) {
      const rise = Math.min(1, p.t / 0.25);
      ui.globalAlpha = p.t > 0.75 ? Math.max(0, 1 - (p.t - 0.75) / 0.25) : 1;
      ui.font = font(p.size, true);
      ui.textAlign = "center";
      ui.textBaseline = "middle";
      outlinedText(ui, p.text, p.x, p.y - rise * 12, p.color);
      ui.globalAlpha = 1;
    }
    this.drawBanner(ui, W);
    this.drawPanels(ui, W, H);
    if (this.phase === "result") this.drawResult(ui, W);

    if (this.fade > 0) {
      ui.fillStyle = `rgba(0,0,0,${this.fade})`;
      ui.fillRect(0, 0, W, H);
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const horizon = 54;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#3a5fa8");
    sky.addColorStop(1, "#9cc8e8");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, horizon);
    // distant hills
    ctx.fillStyle = "#4f8a52";
    for (let x = 0; x < W; x += 2) {
      const h = 8 + Math.sin(x * 0.03) * 5 + Math.sin(x * 0.011 + 1) * 6;
      ctx.fillRect(x, horizon - h, 2, h);
    }
    const ground = ctx.createLinearGradient(0, horizon, 0, H);
    ground.addColorStop(0, "#5aa04a");
    ground.addColorStop(1, "#3b7a32");
    ctx.fillStyle = ground;
    ctx.fillRect(0, horizon, W, H - horizon);
    // grass tufts (fixed pattern)
    ctx.fillStyle = "#6cc04f";
    for (let i = 0; i < 70; i++) {
      const x = (i * 97) % W, y = horizon + 6 + ((i * 53) % (H - horizon - 10));
      ctx.fillRect(x, y, 1, 3);
      ctx.fillRect(x + 2, y + 1, 1, 2);
    }
  }

  private drawBattler(ctx: CanvasRenderingContext2D, b: Battler): void {
    if (b.fade <= 0) return;
    if (b.flash > 0 && Math.floor(this.time * 30) % 2 === 0) return; // blink when hit / acting
    const { w, h } = b.size;
    const shakeX = b.shake > 0 ? Math.sin(this.time * 70) * 3 * b.shake : 0;
    const x = Math.round(b.drawX - w / 2 + shakeX);
    const y = Math.round(b.homeY - h);
    ctx.save();
    ctx.globalAlpha = b.fade * (b.side === "party" && !b.alive ? 0.4 : 1);
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(b.drawX, b.homeY - 1, w * 0.32, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    if (b.sprite) {
      const choosing = this.ready[0] === b && this.phase === "fight";
      b.sprite.draw(ctx, "left", choosing ? this.time : 0, x, y + (b.alive ? 0 : 6), b.scale);
    } else if (b.image) {
      const bob = b.alive ? Math.round(Math.sin(this.time * 3 + b.homeY) * 1) : 0;
      ctx.drawImage(b.image, x, y + bob, w, h);
    }
    ctx.restore();
  }

  private drawEffect(ctx: CanvasRenderingContext2D, e: Effect): void {
    const p = e.t / 0.45;
    ctx.save();
    ctx.globalAlpha = 1 - p;
    ctx.strokeStyle = e.color;
    ctx.fillStyle = e.color;
    if (e.kind === "slash") {
      ctx.lineWidth = 2;
      for (const o of [-6, 0, 6]) {
        ctx.beginPath();
        ctx.moveTo(e.x - 14 + o, e.y - 14);
        ctx.lineTo(e.x - 14 + o + 28 * Math.min(1, p * 3), e.y - 14 + 28 * Math.min(1, p * 3));
        ctx.stroke();
      }
    } else if (e.kind === "burst") {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 4 + p * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = (1 - p) * 0.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 3 + p * 14, 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 0; i < 6; i++) {
        const sx = e.x + Math.sin(i * 2.1) * 12;
        const sy = e.y + 10 - p * 26 - (i % 3) * 5;
        ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      }
    }
    ctx.restore();
  }

  private drawTargetCursor(ctx: CanvasRenderingContext2D): void {
    const mode = this.mode;
    const user = this.ready[0];
    if (mode?.m !== "target" || !user) return;
    const pool = candidates(mode.type, user, this.battlers);
    const targets = this.pickedTargets(mode, pool);
    const bob = Math.sin(this.time * 8) * 2;
    ctx.save();
    ctx.font = font(12, true);
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (const t of targets) outlinedText(ctx, "▼", t.centerX, t.homeY - t.size.h - 1 + bob, COLORS.accent);
    ctx.restore();
  }

  private drawBanner(ctx: CanvasRenderingContext2D, W: number): void {
    let text: string | null = null;
    const mode = this.mode;
    if (this.banner) text = this.banner.text;
    else if (mode?.m === "target") {
      const user = this.ready[0];
      const pool = user ? candidates(mode.type, user, this.battlers) : [];
      const p = pool[mode.index];
      if (isMultiTarget(mode.type)) text = mode.type === "all_enemies" ? "All enemies" : "All allies";
      else if (p && mode.area === "row") text = p.row === "front" ? "Front row" : "Back row";
      else if (p && mode.area === "pierce") text = user ? this.pickedTargets(mode, pool).map((b) => b.name).join(" + ") : p.name;
      else text = p ? `${p.name}${p.row === "back" ? "  (back row)" : ""}` : null;
    } else if ((mode?.m === "skill" || mode?.m === "item") && this.listMenu?.current?.help) {
      text = this.listMenu.current.help;
    }
    if (!text) return;
    ctx.font = font(11);
    const w = Math.min(W - 16, Math.max(90, ctx.measureText(text).width + 24));
    const x = (W - w) / 2;
    drawPanel(ctx, x, 6, w, 20);
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, W / 2, 16.5);
  }

  /** Puts a menu in the left part of the bottom panel. */
  private placeMenu(menu: Menu): Menu {
    const W = this.game.display.uiWidth, H = this.game.display.uiHeight;
    this.panelTop = H - 78;
    return Object.assign(menu, { x: 4, y: this.panelTop, w: Math.round(Math.min(178, W * 0.4)), h: H - this.panelTop - 4 });
  }

  private drawPanels(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const top = this.panelTop;
    const ph = H - top - 4;
    const leftW = Math.round(Math.min(178, W * 0.4));

    // Left: command / list menu, or the enemy list.
    const menu = this.mode?.m === "skill" || this.mode?.m === "item" ? this.listMenu : this.mode ? this.commandMenu : null;
    if (menu) {
      this.placeMenu(menu).render(ctx, this.mode?.m !== "target");
    } else {
      drawPanel(ctx, 4, top, leftW, ph);
      // e.g. "Slime ×2", "Goblin Archer · back"
      const names = new Map<string, number>();
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const key = e.enemy!.name + (e.row === "back" ? "  · back" : "");
        names.set(key, (names.get(key) ?? 0) + 1);
      }
      ctx.font = font(11);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      [...names].slice(0, 4).forEach(([n, c], i) => ctx.fillText(c > 1 ? `${n} ×${c}` : n, 14, top + 13 + i * 17));
    }

    // Right: party status.
    const sx = leftW + 8, sw = W - sx - 4;
    drawPanel(ctx, sx, top, sw, ph);
    const rowH = (ph - 6) / 3;
    const active = this.ready[0];
    this.party.forEach((b, i) => {
      const y = top + 3 + i * rowH + rowH / 2;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = font(11, b === active);
      ctx.fillStyle = !b.alive ? COLORS.hpLow : b === active ? COLORS.accent : COLORS.text;
      ctx.fillText(b.name, sx + 8, y);
      // Small tags: back row, defending, covering
      const tags = [b.row === "back" ? "BACK" : "", b.defending ? "DEF" : "", b.covering ? "COVER" : ""].filter(Boolean);
      if (tags.length) {
        ctx.font = font(7);
        ctx.fillStyle = COLORS.mp;
        ctx.fillText(tags.join(" "), sx + 8, y + 9);
      }
      // HP
      const hpX = sx + Math.round(sw * 0.3);
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText("HP", hpX, y);
      ctx.font = font(11, true);
      ctx.fillStyle = !b.alive ? COLORS.hpLow : b.hp / b.stats.hp < 0.25 ? COLORS.hpLow : COLORS.text;
      ctx.textAlign = "right";
      ctx.fillText(`${b.hp}`, hpX + 44, y);
      ctx.font = font(9);
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = "left";
      ctx.fillText(`/${b.stats.hp}`, hpX + 45, y + 1);
      // MP
      const mpX = sx + Math.round(sw * 0.58);
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText("MP", mpX, y);
      ctx.font = font(11, true);
      ctx.fillStyle = COLORS.mp;
      ctx.textAlign = "right";
      ctx.fillText(`${b.mp}`, mpX + 36, y);
      // ATB gauge
      const gx = sx + Math.round(sw * 0.76), gw = sw - (gx - sx) - 8;
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(gx, y - 3, gw, 6);
      ctx.fillStyle = b.atb >= 1 ? COLORS.atbFull : COLORS.atb;
      if (b.alive) ctx.fillRect(gx, y - 3, gw * b.atb, 6);
    });
  }

  private drawResult(ctx: CanvasRenderingContext2D, W: number): void {
    // Level-ups can add several lines; tighten the spacing so it still fits above the panel.
    const lh = this.resultLines.length > 5 ? 13 : 16;
    const w = Math.min(W - 40, 280), h = 30 + this.resultLines.length * lh;
    const x = (W - w) / 2, y = Math.max(4, (this.panelTop - h) / 2 + 4);
    drawPanel(ctx, x, y, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.resultLines.forEach((line, i) => {
      ctx.font = font(i === 0 ? 14 : 10, i === 0);
      ctx.fillStyle = i === 0 ? COLORS.accent : COLORS.text;
      ctx.fillText(line, W / 2, y + 14 + i * lh);
    });
    if (Math.floor(this.time * 2) % 2 === 0) {
      ctx.font = font(9);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText("Press A to continue", W / 2, y + h - 8);
    }
  }
}
