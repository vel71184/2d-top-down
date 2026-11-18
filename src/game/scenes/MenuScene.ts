import { padSettings } from "../../engine/gamepad";
import { Scene } from "../../engine/scene";
import { battleSettings } from "../battle/BattleScene";
import type { RPG } from "../context";
import type { ItemDef } from "../data";
import { saveSettings } from "../settings";
import type { PartyMember } from "../state";
import { Menu } from "../ui/Menu";
import { COLORS, drawPanel, font } from "../ui/theme";

type Mode =
  | { m: "main" }
  | { m: "items" }
  | { m: "itemTarget"; itemId: string }
  | { m: "statusPick" }
  | { m: "status"; member: PartyMember }
  | { m: "settings" };

const MAIN = ["Items", "Status", "Settings", "Close"];
const ROW_H = 44;

/**
 * The field menu (☰ / Y / Start while walking around). Drawn over the map.
 * Equipment and saving join it in stage 4.
 */
export class MenuScene extends Scene {
  transparent = true;
  private mode: Mode = { m: "main" };
  private main = new Menu(MAIN.map((label) => ({ label })), 8, 8, 100, 4 * 20 + 8, 1, 20);
  private items: Menu | null = null;
  private itemIds: string[] = [];
  private settings: Menu | null = null;
  /** Highlighted party member when choosing one. */
  private partyCursor = 0;
  private message: { text: string; t: number } | null = null;

  constructor(private rpg: RPG) {
    super(rpg.game);
  }

  enter(): void {
    this.game.input.reset();
  }

  private close(): void {
    this.game.scenes.pop();
    this.game.input.reset();
  }

  update(dt: number): void {
    const input = this.game.input;
    if (this.message) {
      this.message.t += dt;
      if (this.message.t > 1.4) this.message = null;
    }
    // The menu button closes the menu from anywhere.
    if (input.pressed("menu")) return this.close();

    const mode = this.mode;
    switch (mode.m) {
      case "main": {
        const r = this.main.update(input, false);
        if (r?.type === "cancel") return this.close();
        if (r?.type !== "select") return;
        if (r.index === 0) this.openItems();
        else if (r.index === 1) {
          this.partyCursor = 0;
          this.mode = { m: "statusPick" };
        } else if (r.index === 2) this.openSettings();
        else this.close();
        return;
      }
      case "items": {
        const r = this.items!.update(input, false);
        if (r?.type === "cancel") this.mode = { m: "main" };
        else if (r?.type === "select") {
          this.partyCursor = 0;
          this.mode = { m: "itemTarget", itemId: this.itemIds[r.index] };
        }
        return;
      }
      case "itemTarget":
      case "statusPick": {
        const n = this.rpg.state.party.length;
        const nav = input.nav();
        if (nav === "up" || nav === "left") this.partyCursor = (this.partyCursor - 1 + n) % n;
        if (nav === "down" || nav === "right") this.partyCursor = (this.partyCursor + 1) % n;
        if (input.pressed("cancel")) {
          if (mode.m === "itemTarget") this.openItems();
          else this.mode = { m: "main" };
          return;
        }
        if (!input.pressed("confirm")) return;
        const member = this.rpg.state.party[this.partyCursor];
        if (mode.m === "statusPick") this.mode = { m: "status", member };
        else this.useItem(mode.itemId, member);
        return;
      }
      case "status":
        if (input.pressed("cancel") || input.pressed("confirm")) this.mode = { m: "statusPick" };
        return;
      case "settings": {
        const r = this.settings!.update(input, false);
        if (r?.type === "cancel") {
          this.mode = { m: "main" };
          return;
        }
        if (r?.type !== "select") return;
        if (r.index === 0) battleSettings.atbMode = battleSettings.atbMode === "wait" ? "active" : "wait";
        else padSettings.swapConfirmCancel = !padSettings.swapConfirmCancel;
        saveSettings();
        this.settings!.items = this.settingsItems();
        return;
      }
    }
  }

  private openItems(): void {
    const { db, state } = this.rpg;
    this.itemIds = [...state.inventory.keys()];
    if (this.itemIds.length === 0) {
      this.flash("You have no items.");
      this.mode = { m: "main" };
      return;
    }
    const keep = this.items?.cursor ?? 0;
    this.items = new Menu(
      this.itemIds.map((id) => ({ label: db.items[id].name, right: `×${state.itemCount(id)}`, help: db.items[id].desc })),
      8, 8, 150, 6 * 18 + 8, 1, 18,
    );
    this.items.cursor = Math.min(keep, this.itemIds.length - 1);
    this.mode = { m: "items" };
  }

  private useItem(itemId: string, m: PartyMember): void {
    const { db, state } = this.rpg;
    const item = db.items[itemId];
    const result = applyItem(item, m);
    if (!result) {
      this.flash("It would have no effect.");
      return;
    }
    state.useItem(itemId);
    this.flash(`${m.def.name}: ${result}`);
    if (state.itemCount(itemId) === 0) this.openItems();
  }

  private settingsItems() {
    return [
      { label: "Battle gauges", right: battleSettings.atbMode === "wait" ? "Wait" : "Active", help: battleSettings.atbMode === "wait" ? "Gauges pause while you pick a command." : "Gauges keep filling while you pick a command." },
      { label: "Confirm button", right: padSettings.swapConfirmCancel ? "Right" : "Bottom", help: "Which controller face button confirms (the other one cancels)." },
    ];
  }

  private openSettings(): void {
    this.settings = new Menu(this.settingsItems(), 8, 8, 190, 2 * 20 + 8, 1, 20);
    this.mode = { m: "settings" };
  }

  private flash(text: string): void {
    this.message = { text, t: 0 };
  }

  // --------------------------------------------------------------- render

  render(_world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const W = this.game.display.uiWidth, H = this.game.display.uiHeight;
    ui.fillStyle = "rgba(0,0,0,0.45)";
    ui.fillRect(0, 0, W, H);

    const mode = this.mode.m;
    const leftMenu = mode === "items" || mode === "itemTarget" ? this.items : mode === "settings" ? this.settings : this.main;
    leftMenu?.render(ui, mode === "main" || mode === "items" || mode === "settings");

    // Gold under the left column
    const gy = (leftMenu?.y ?? 8) + (leftMenu?.h ?? 0) + 6;
    drawPanel(ui, 8, gy, 100, 22);
    ui.font = font(11);
    ui.textBaseline = "middle";
    ui.textAlign = "left";
    ui.fillStyle = COLORS.dim;
    ui.fillText("Gold", 16, gy + 11.5);
    ui.textAlign = "right";
    ui.fillStyle = COLORS.accent;
    ui.fillText(String(this.rpg.state.gold), 100, gy + 11.5);

    const px = Math.max(leftMenu?.w ?? 100, 100) + 16;
    this.drawParty(ui, px, 8, W - px - 8);

    const help = leftMenu === this.items || leftMenu === this.settings ? leftMenu?.current?.help : undefined;
    const bottom = this.message?.text ?? (mode === "itemTarget" ? "Use on whom?" : mode === "statusPick" ? "Whose status?" : help);
    if (bottom) {
      drawPanel(ui, 8, H - 30, W - 16, 22);
      ui.font = font(11);
      ui.textAlign = "center";
      ui.fillStyle = this.message ? COLORS.accent : COLORS.text;
      ui.fillText(bottom, W / 2, H - 18.5);
    }

    if (this.mode.m === "status") {
      ui.fillStyle = "rgba(0,0,0,0.6)";
      ui.fillRect(0, 0, W, H);
      this.drawStatus(ui, this.mode.member, W, H);
    }
  }

  private drawParty(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const party = this.rpg.state.party;
    drawPanel(ctx, x, y, w, party.length * ROW_H + 8);
    const picking = this.mode.m === "itemTarget" || this.mode.m === "statusPick";
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
      // portrait
      ctx.imageSmoothingEnabled = false;
      const sheet = this.rpg.sprites.get(m.def.sprite);
      if (sheet) {
        const s = 32 / sheet.frameH;
        sheet.draw(ctx, "down", 0, x + 18, ry + 6, s);
      }
      const tx = x + 58;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.font = font(12, true);
      ctx.fillStyle = m.hp === 0 ? COLORS.hpLow : COLORS.text;
      ctx.fillText(m.def.name, tx, ry + 11);
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.fillText(`Lv ${m.level}`, tx + 50, ry + 11);
      const barW = Math.max(60, Math.min(140, w - (tx - x) - 70));
      bar(ctx, tx, ry + 22, barW, "HP", m.hp, m.def.stats.hp, m.hp / m.def.stats.hp < 0.25 ? COLORS.hpLow : COLORS.hp);
      bar(ctx, tx, ry + 34, barW, "MP", m.mp, m.def.stats.mp, COLORS.mp);
    });
  }

  private drawStatus(ctx: CanvasRenderingContext2D, m: PartyMember, W: number, H: number): void {
    const w = 220, h = 150;
    const x = (W - w) / 2, y = (H - h) / 2 - 6;
    drawPanel(ctx, x, y, w, h);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = font(13, true);
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(`${m.def.name}  ·  Lv ${m.level}`, x + 12, y + 14);
    ctx.font = font(10);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText(`XP ${m.xp}`, x + 150, y + 14);
    const st = m.def.stats;
    const rows: [string, string][] = [
      ["HP", `${m.hp} / ${st.hp}`], ["MP", `${m.mp} / ${st.mp}`],
      ["Attack", String(st.atk)], ["Defense", String(st.def)],
      ["Magic", String(st.mag)], ["Speed", String(st.spd)],
    ];
    rows.forEach(([k, v], i) => {
      const cx = x + 12 + (i % 2) * 104, cy = y + 36 + Math.floor(i / 2) * 18;
      ctx.font = font(10);
      ctx.fillStyle = COLORS.dim;
      ctx.textAlign = "left";
      ctx.fillText(k, cx, cy);
      ctx.font = font(11, true);
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "right";
      ctx.fillText(v, cx + 92, cy);
    });
    ctx.textAlign = "left";
    ctx.font = font(10);
    ctx.fillStyle = COLORS.dim;
    ctx.fillText("Skills", x + 12, y + 96);
    ctx.font = font(11);
    ctx.fillStyle = COLORS.text;
    const skills = m.def.skills.map((id) => this.rpg.db.skills[id]?.name ?? id).join(", ");
    ctx.fillText(skills || "—", x + 12, y + 112, w - 24);
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
function applyItem(item: ItemDef, m: PartyMember): string | null {
  const e = item.effect;
  const st = m.def.stats;
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
