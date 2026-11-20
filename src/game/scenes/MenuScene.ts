import { padSettings } from "../../engine/gamepad";
import { Scene } from "../../engine/scene";
import { battleSettings } from "../battle/BattleScene";
import type { RPG } from "../context";
import { SLOTS, thingName, type ItemDef, type Slot, type Stats } from "../data";
import { canEquip, clampHpMp, memberStats, skillsOf, totalXpFor } from "../party";
import { describeSave, makeSave, readSave, SAVE_SLOTS, writeSave, type Position } from "../save";
import { saveSettings } from "../settings";
import type { PartyMember } from "../state";
import { Menu, type MenuItem } from "../ui/Menu";
import { COLORS, drawPanel, font } from "../ui/theme";
import { thingInfo } from "./ShopScene";

type Mode =
  | { m: "main" }
  | { m: "items" }
  | { m: "itemTarget"; itemId: string }
  | { m: "pick"; purpose: "status" | "equip" | "formation" }
  | { m: "status"; member: PartyMember }
  | { m: "equipSlots"; member: PartyMember }
  | { m: "equipChoose"; member: PartyMember; slot: Slot; options: (string | null)[] }
  | { m: "settings" }
  | { m: "save" };

const MAIN = ["Items", "Equip", "Status", "Formation", "Settings", "Save", "Close"];
const ROW_H = 44;
const SLOT_NAMES: Record<Slot, string> = { weapon: "Weapon", armor: "Armor", accessory: "Accessory" };
const STAT_ROWS: [keyof Stats, string][] = [["hp", "Max HP"], ["mp", "Max MP"], ["atk", "Attack"], ["def", "Defense"], ["mag", "Magic"], ["spd", "Speed"]];

/**
 * The field menu (☰ / Y / Start while walking around), drawn over the map.
 */
export class MenuScene extends Scene {
  transparent = true;
  private mode: Mode = { m: "main" };
  private main = new Menu(MAIN.map((label) => ({ label })), 8, 8, 100, MAIN.length * 20 + 8, 1, 20);
  private sub: Menu | null = null; // items / settings / save / equip lists
  private itemIds: string[] = [];
  private partyCursor = 0;
  private message: { text: string; t: number } | null = null;

  constructor(private rpg: RPG, private getPosition: () => Position) {
    super(rpg.game);
  }

  enter(): void {
    this.game.input.reset();
  }

  private close(): void {
    this.game.scenes.pop();
    this.game.input.reset();
  }

  private get db() {
    return this.rpg.db;
  }
  private get state() {
    return this.rpg.state;
  }

  update(dt: number): void {
    const input = this.game.input;
    if (this.message) {
      this.message.t += dt;
      if (this.message.t > 1.6) this.message = null;
    }
    if (input.pressed("menu")) return this.close();

    const mode = this.mode;
    switch (mode.m) {
      case "main": {
        const r = this.main.update(input, false);
        if (r?.type === "cancel") return this.close();
        if (r?.type !== "select") return;
        switch (MAIN[r.index]) {
          case "Items": return this.openItems();
          case "Equip": return this.pick("equip");
          case "Status": return this.pick("status");
          case "Formation": return this.pick("formation");
          case "Settings": return this.openSettings();
          case "Save": return this.openSave();
          default: return this.close();
        }
      }
      case "items": {
        const r = this.sub!.update(input, false);
        if (r?.type === "cancel") this.mode = { m: "main" };
        else if (r?.type === "select") this.mode = { m: "itemTarget", itemId: this.itemIds[r.index] };
        return;
      }
      case "itemTarget":
      case "pick": {
        const n = this.state.party.length;
        const nav = input.nav();
        if (nav === "up" || nav === "left") this.partyCursor = (this.partyCursor - 1 + n) % n;
        if (nav === "down" || nav === "right") this.partyCursor = (this.partyCursor + 1) % n;
        if (input.pressed("cancel")) {
          if (mode.m === "itemTarget") this.openItems();
          else this.mode = { m: "main" };
          return;
        }
        if (!input.pressed("confirm")) return;
        const member = this.state.party[this.partyCursor];
        if (mode.m === "itemTarget") this.useItem(mode.itemId, member);
        else if (mode.purpose === "formation") {
          member.row = member.row === "front" ? "back" : "front";
          this.flash(`${member.def.name} moves to the ${member.row} row.`);
        } else if (mode.purpose === "status") this.mode = { m: "status", member };
        else this.openEquipSlots(member);
        return;
      }
      case "status":
        if (input.pressed("cancel") || input.pressed("confirm")) this.mode = { m: "pick", purpose: "status" };
        return;
      case "equipSlots": {
        const r = this.sub!.update(input, false);
        if (r?.type === "cancel") return this.pick("equip");
        if (r?.type === "select") this.openEquipChoose(mode.member, SLOTS[r.index]);
        return;
      }
      case "equipChoose": {
        const r = this.sub!.update(input, false);
        if (r?.type === "cancel") return this.openEquipSlots(mode.member, SLOTS.indexOf(mode.slot));
        if (r?.type !== "select") return;
        this.equip(mode.member, mode.slot, mode.options[r.index]);
        this.openEquipSlots(mode.member, SLOTS.indexOf(mode.slot));
        return;
      }
      case "settings": {
        const r = this.sub!.update(input, false);
        if (r?.type === "cancel") {
          this.mode = { m: "main" };
          return;
        }
        if (r?.type !== "select") return;
        if (r.index === 0) battleSettings.atbMode = battleSettings.atbMode === "wait" ? "active" : "wait";
        else padSettings.swapConfirmCancel = !padSettings.swapConfirmCancel;
        saveSettings();
        this.sub!.items = this.settingsItems();
        return;
      }
      case "save": {
        const r = this.sub!.update(input, false);
        if (r?.type === "cancel") {
          this.mode = { m: "main" };
          return;
        }
        if (r?.type !== "select") return;
        const ok = writeSave(r.index, makeSave(this.state, this.getPosition()));
        this.flash(ok ? `Saved to slot ${r.index + 1}.` : "Couldn't save on this device.");
        const keep = this.sub!.cursor;
        this.openSave();
        this.sub!.cursor = keep;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- modes

  private pick(purpose: "status" | "equip" | "formation"): void {
    this.mode = { m: "pick", purpose };
  }

  private openItems(): void {
    this.itemIds = [...this.state.inventory.keys()].filter((id) => this.db.items[id]);
    if (this.itemIds.length === 0) {
      this.flash("You have no items.");
      this.mode = { m: "main" };
      return;
    }
    const keep = this.mode.m === "itemTarget" || this.mode.m === "items" ? this.sub?.cursor ?? 0 : 0;
    this.sub = new Menu(
      this.itemIds.map((id) => ({ label: this.db.items[id].name, right: `×${this.state.itemCount(id)}`, help: this.db.items[id].desc })),
      8, 8, 150, 6 * 18 + 8, 1, 18,
    );
    this.sub.cursor = Math.min(keep, this.itemIds.length - 1);
    this.mode = { m: "items" };
  }

  private useItem(itemId: string, m: PartyMember): void {
    const result = applyItem(this.db.items[itemId], m, memberStats(this.db, m));
    if (!result) return this.flash("It would have no effect.");
    this.state.useItem(itemId);
    this.flash(`${m.def.name}: ${result}`);
    if (this.state.itemCount(itemId) === 0) this.openItems();
  }

  private openEquipSlots(member: PartyMember, cursor = 0): void {
    this.sub = new Menu(
      SLOTS.map((slot) => ({ label: SLOT_NAMES[slot], right: member.equip[slot] ? thingName(this.db, member.equip[slot]!) : "—" })),
      8, 8, 220, SLOTS.length * 20 + 8, 1, 20,
    );
    this.sub.cursor = cursor;
    this.mode = { m: "equipSlots", member };
  }

  private openEquipChoose(member: PartyMember, slot: Slot): void {
    const owned = [...this.state.inventory.keys()].filter((id) => {
      const e = this.db.equipment[id];
      return e && e.slot === slot && canEquip(e, member.id);
    });
    const options: (string | null)[] = [null, ...owned];
    const items: MenuItem[] = options.map((id) =>
      id
        ? { label: thingName(this.db, id), right: `×${this.state.itemCount(id)}`, help: thingInfo(this.db, id) }
        : { label: "(Remove)", help: "Take it off." },
    );
    this.sub = new Menu(items, 8, 8, 220, 6 * 18 + 8, 1, 18);
    this.sub.cursor = owned.length ? 1 : 0;
    this.mode = { m: "equipChoose", member, slot, options };
  }

  private equip(m: PartyMember, slot: Slot, id: string | null): void {
    const old = m.equip[slot] ?? null;
    if (old === id) return;
    if (old) this.state.addItem(old);
    if (id) this.state.useItem(id);
    m.equip[slot] = id;
    clampHpMp(this.db, m);
    this.flash(id ? `${m.def.name} equipped ${thingName(this.db, id)}.` : `${m.def.name} removed ${thingName(this.db, old!)}.`);
  }

  private settingsItems(): MenuItem[] {
    return [
      { label: "Battle gauges", right: battleSettings.atbMode === "wait" ? "Wait" : "Active", help: battleSettings.atbMode === "wait" ? "Gauges pause while you pick a command." : "Gauges keep filling while you pick a command." },
      { label: "Confirm button", right: padSettings.swapConfirmCancel ? "Right" : "Bottom", help: "Which controller face button confirms (the other one cancels)." },
    ];
  }

  private openSettings(): void {
    this.sub = new Menu(this.settingsItems(), 8, 8, 190, 2 * 20 + 8, 1, 20);
    this.mode = { m: "settings" };
  }

  private openSave(): void {
    const items: MenuItem[] = [];
    for (let i = 0; i < SAVE_SLOTS; i++) {
      const d = readSave(i);
      items.push({ label: `Slot ${i + 1}`, right: d ? describeSave(this.db, d) : "— empty —", help: d ? "Overwrite this save." : "Save here." });
    }
    this.sub = new Menu(items, 8, 8, 260, SAVE_SLOTS * 22 + 8, 1, 22);
    this.mode = { m: "save" };
  }

  private flash(text: string): void {
    this.message = { text, t: 0 };
  }

  // --------------------------------------------------------------- render

  render(_world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const W = this.game.display.uiWidth, H = this.game.display.uiHeight;
    ui.fillStyle = "rgba(0,0,0,0.45)";
    ui.fillRect(0, 0, W, H);
    const m = this.mode.m;

    const showSub = m === "items" || m === "itemTarget" || m === "settings" || m === "save" || m === "equipSlots" || m === "equipChoose";
    const left = showSub ? this.sub! : this.main;
    left.render(ui, m !== "itemTarget" && m !== "pick" && m !== "status");

    // Gold under the left column
    const gy = left.y + left.h + 6;
    drawPanel(ui, 8, gy, 100, 22);
    ui.font = font(11);
    ui.textBaseline = "middle";
    ui.textAlign = "left";
    ui.fillStyle = COLORS.dim;
    ui.fillText("Gold", 16, gy + 11.5);
    ui.textAlign = "right";
    ui.fillStyle = COLORS.accent;
    ui.fillText(String(this.state.gold), 100, gy + 11.5);

    const px = Math.max(left.w, 100) + 16;
    if (this.mode.m === "equipSlots" || this.mode.m === "equipChoose") {
      const preview =
        this.mode.m === "equipChoose" ? { [this.mode.slot]: this.mode.options[this.sub!.cursor] } : undefined;
      this.drawEquipStats(ui, this.mode.member, preview, px, 8, W - px - 8);
    } else {
      this.drawParty(ui, px, 8, W - px - 8);
    }

    const help = showSub && m !== "itemTarget" ? this.sub?.current?.help : undefined;
    const pickPrompts = {
      equip: "Equip whom?",
      status: "Whose status?",
      formation: "Choose someone to switch rows. Front: full melee damage. Back: safer from melee.",
    };
    const prompt = m === "itemTarget" ? "Use on whom?" : this.mode.m === "pick" ? pickPrompts[this.mode.purpose] : help;
    const bottom = this.message?.text ?? prompt;
    if (bottom) {
      drawPanel(ui, 8, H - 30, W - 16, 22);
      ui.font = font(11);
      ui.textAlign = "center";
      ui.fillStyle = this.message ? COLORS.accent : COLORS.text;
      ui.fillText(bottom, W / 2, H - 18.5, W - 32);
    }

    if (this.mode.m === "status") {
      ui.fillStyle = "rgba(0,0,0,0.6)";
      ui.fillRect(0, 0, W, H);
      this.drawStatus(ui, this.mode.member, W, H);
    }
  }

  private drawParty(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const party = this.state.party;
    drawPanel(ctx, x, y, w, party.length * ROW_H + 8);
    const picking = this.mode.m === "itemTarget" || this.mode.m === "pick";
    party.forEach((m, i) => {
      const ry = y + 4 + i * ROW_H;
      if (picking && i === this.partyCursor) {
        ctx.fillStyle = COLORS.cursor;
        ctx.fillRect(x + 4, ry + 1, w - 8, ROW_H - 2);
        ctx.fillStyle = COLORS.accent;
        ctx.font = font(9);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText("▶", x + 7, ry + ROW_H / 2);
      }
      this.portrait(ctx, m, x + 18, ry + 6);
      const st = memberStats(this.db, m);
      const tx = x + 58;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = font(12, true);
      ctx.fillStyle = m.hp === 0 ? COLORS.hpLow : COLORS.text;
      ctx.fillText(m.def.name, tx, ry + 11);
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`Lv ${m.level}`, tx + 50, ry + 11);
      ctx.textAlign = "right";
      ctx.fillStyle = m.row === "back" ? COLORS.mp : COLORS.dim;
      ctx.fillText(m.row === "back" ? "Back row" : "Front row", x + w - 10, ry + 11);
      ctx.textAlign = "left";
      const barW = Math.max(60, Math.min(140, w - (tx - x) - 70));
      bar(ctx, tx, ry + 22, barW, "HP", m.hp, st.hp, m.hp / st.hp < 0.25 ? COLORS.hpLow : COLORS.hp);
      bar(ctx, tx, ry + 34, barW, "MP", m.mp, st.mp, COLORS.mp);
    });
  }

  private portrait(ctx: CanvasRenderingContext2D, m: PartyMember, x: number, y: number): void {
    ctx.imageSmoothingEnabled = false;
    const sheet = this.rpg.sprites.get(m.def.sprite);
    if (sheet) sheet.draw(ctx, "down", 0, x, y, 32 / sheet.frameH);
  }

  /** Stats panel for the equip screen; `preview` shows the change if an item were equipped. */
  private drawEquipStats(ctx: CanvasRenderingContext2D, m: PartyMember, preview: Partial<Record<string, string | null>> | undefined, x: number, y: number, w: number): void {
    const h = 30 + STAT_ROWS.length * 16 + 6;
    drawPanel(ctx, x, y, w, h);
    this.portrait(ctx, m, x + 8, y + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = font(12, true);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${m.def.name}  ·  Lv ${m.level}`, x + 46, y + 18);
    const now = memberStats(this.db, m);
    const after = preview ? memberStats(this.db, m, preview) : now;
    STAT_ROWS.forEach(([k, label], i) => {
      const ry = y + 40 + i * 16;
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = "left";
      ctx.fillText(label, x + 12, ry);
      ctx.font = font(11, true);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "right";
      ctx.fillText(String(now[k]), x + 100, ry);
      if (after[k] !== now[k]) {
        ctx.fillStyle = after[k] > now[k] ? COLORS.hp : COLORS.hpLow;
        ctx.fillText(`→ ${after[k]}`, x + 150, ry);
      }
    });
  }

  private drawStatus(ctx: CanvasRenderingContext2D, m: PartyMember, W: number, H: number): void {
    const w = 240, h = 176;
    const x = (W - w) / 2, y = (H - h) / 2 - 6;
    drawPanel(ctx, x, y, w, h);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = font(13, true);
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(`${m.def.name}  ·  Lv ${m.level}`, x + 12, y + 14);
    ctx.font = font(10);
    ctx.fillStyle = COLORS.dim;
    ctx.textAlign = "right";
    const next = totalXpFor(m.level + 1) - m.xp;
    ctx.fillText(`XP ${m.xp} · next ${next}`, x + w - 12, y + 14);
    const st = memberStats(this.db, m);
    const rows: [string, string][] = [
      ["HP", `${m.hp} / ${st.hp}`], ["MP", `${m.mp} / ${st.mp}`],
      ["Attack", String(st.atk)], ["Defense", String(st.def)],
      ["Magic", String(st.mag)], ["Speed", String(st.spd)],
    ];
    rows.forEach(([k, v], i) => {
      const cx = x + 12 + (i % 2) * 114, cy = y + 36 + Math.floor(i / 2) * 18;
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = "left";
      ctx.fillText(k, cx, cy);
      ctx.font = font(11, true);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "right";
      ctx.fillText(v, cx + 100, cy);
    });
    ctx.textAlign = "left";
    ctx.font = font(10);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText("Equipment", x + 12, y + 96);
    ctx.fillText("Skills", x + 12, y + 128);
    ctx.font = font(11);
    ctx.fillStyle = COLORS.text;
    const gear = SLOTS.map((s) => (m.equip[s] ? thingName(this.db, m.equip[s]!) : "—")).join(", ");
    ctx.fillText(gear, x + 12, y + 111, w - 24);
    const skills = skillsOf(this.db, m).map((id) => this.db.skills[id]?.name ?? id).join(", ");
    ctx.fillText(skills || "—", x + 12, y + 143, w - 24);
    ctx.font = font(9);
    ctx.fillStyle = COLORS.dim;
    ctx.textAlign = "center";
    ctx.fillText("B to go back", x + w / 2, y + h - 10);
  }
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, label: string, v: number, max: number, color: string): void {
  ctx.font = font(9);
  ctx.fillStyle = COLORS.dim;
  ctx.textAlign = "left";
  ctx.fillText(label, x, y);
  const bx = x + 18, bw = w - 18 - 52;
  ctx.fillStyle = "rgba(255,255,255,0.15)";
  ctx.fillRect(bx, y - 2.5, bw, 5);
  ctx.fillStyle = color;
  ctx.fillRect(bx, y - 2.5, bw * Math.max(0, Math.min(1, v / max)), 5);
  ctx.font = font(10);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "right";
  ctx.fillText(`${v}/${max}`, x + w, y);
}

/** Applies an item to a party member outside battle. Returns a short result, or null if it would do nothing. */
function applyItem(item: ItemDef, m: PartyMember, st: Stats): string | null {
  const e = item.effect;
  if (e.revive) {
    if (m.hp > 0) return null;
    m.hp = Math.max(1, Math.round(st.hp * e.revive));
    return "revived!";
  }
  if (m.hp === 0) return null;
  const parts: string[] = [];
  if (e.hp && m.hp < st.hp) {
    const before = m.hp;
    m.hp = Math.min(st.hp, m.hp + e.hp);
    parts.push(`+${m.hp - before} HP`);
  }
  if (e.mp && m.mp < st.mp) {
    const before = m.mp;
    m.mp = Math.min(st.mp, m.mp + e.mp);
    parts.push(`+${m.mp - before} MP`);
  }
  return parts.length ? parts.join(", ") : null;
}
