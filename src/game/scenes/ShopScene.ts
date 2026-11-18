import { Scene } from "../../engine/scene";
import type { RPG } from "../context";
import { thingName, thingPrice, type Database, type Stats } from "../data";
import { Menu, type MenuItem } from "../ui/Menu";
import { COLORS, drawPanel, font } from "../ui/theme";

const STAT_LABELS: [keyof Stats, string][] = [["hp", "HP"], ["mp", "MP"], ["atk", "ATK"], ["def", "DEF"], ["mag", "MAG"], ["spd", "SPD"]];

/** One-line description of an item or piece of equipment (stats and who can use it). */
export function thingInfo(db: Database, id: string): string {
  const item = db.items[id];
  if (item) return item.desc;
  const e = db.equipment[id];
  if (!e) return "";
  const stats = STAT_LABELS.filter(([k]) => e.stats[k]).map(([k, l]) => `${l} ${e.stats[k]! > 0 ? "+" : ""}${e.stats[k]}`);
  const who = e.users ? e.users.map((u) => db.characters[u]?.name ?? u).join(", ") : "Anyone";
  const slot = e.slot.charAt(0).toUpperCase() + e.slot.slice(1);
  return [slot, stats.join(" "), who, e.desc].filter(Boolean).join(" · ");
}

/** Buy and sell (shop objects on the map). Sells for half the price. */
export class ShopScene extends Scene {
  transparent = true;
  private main = new Menu([{ label: "Buy" }, { label: "Sell" }, { label: "Leave" }], 8, 8, 100, 3 * 20 + 8, 1, 20);
  private list: Menu | null = null;
  private listIds: string[] = [];
  private mode: "main" | "buy" | "sell" = "main";
  private message: { text: string; t: number } | null = null;

  constructor(private rpg: RPG, private shopName: string, private stock: string[], private greeting: string) {
    super(rpg.game);
  }

  enter(): void {
    this.game.input.reset();
  }

  private leave(): void {
    this.game.scenes.pop();
    this.game.input.reset();
  }

  update(dt: number): void {
    const input = this.game.input;
    if (this.message) {
      this.message.t += dt;
      if (this.message.t > 1.5) this.message = null;
    }
    if (this.mode === "main") {
      const r = this.main.update(input, false);
      if (r?.type === "cancel" || (r?.type === "select" && r.index === 2)) return this.leave();
      if (r?.type === "select") r.index === 0 ? this.openBuy() : this.openSell();
      return;
    }
    const r = this.list!.update(input, false);
    if (r?.type === "cancel") {
      this.mode = "main";
      this.list = null;
      return;
    }
    if (r?.type !== "select") return;
    const { db, state } = this.rpg;
    const id = this.listIds[r.index];
    const keep = this.list!.cursor;
    if (this.mode === "buy") {
      const price = thingPrice(db, id);
      state.gold -= price;
      state.addItem(id);
      this.say(`Bought ${thingName(db, id)}.`);
      this.openBuy();
    } else {
      state.gold += sellPrice(db, id);
      state.useItem(id);
      this.say(`Sold ${thingName(db, id)}.`);
      this.openSell();
    }
    if (this.list) this.list.cursor = Math.min(keep, this.list.items.length - 1);
  }

  private say(text: string): void {
    this.message = { text, t: 0 };
  }

  private openBuy(): void {
    const { db, state } = this.rpg;
    this.listIds = this.stock.filter((id) => db.items[id] || db.equipment[id]);
    this.list = new Menu(
      this.listIds.map((id) => ({
        label: thingName(db, id),
        right: `${thingPrice(db, id)} G`,
        disabled: thingPrice(db, id) > state.gold,
        help: thingInfo(db, id),
      })),
      8, 8, 190, 7 * 18 + 8, 1, 18,
    );
    this.mode = "buy";
  }

  private openSell(): void {
    const { db, state } = this.rpg;
    this.listIds = [...state.inventory.keys()].filter((id) => sellPrice(db, id) > 0);
    if (this.listIds.length === 0) {
      this.say("You have nothing to sell.");
      this.mode = "main";
      return;
    }
    const items: MenuItem[] = this.listIds.map((id) => ({
      label: `${thingName(db, id)} ×${state.itemCount(id)}`,
      right: `${sellPrice(db, id)} G`,
      help: thingInfo(db, id),
    }));
    this.list = new Menu(items, 8, 8, 190, 7 * 18 + 8, 1, 18);
    this.mode = "sell";
  }

  render(_world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const W = this.game.display.uiWidth, H = this.game.display.uiHeight;
    ui.fillStyle = "rgba(0,0,0,0.35)";
    ui.fillRect(0, 0, W, H);
    const menu = this.mode === "main" ? this.main : this.list!;
    menu.render(ui);

    // Shop name + gold + owned count
    const px = menu.x + menu.w + 8, pw = Math.min(160, W - px - 8);
    drawPanel(ui, px, 8, pw, 52);
    ui.textBaseline = "middle";
    ui.textAlign = "left";
    ui.font = font(12, true);
    ui.fillStyle = COLORS.accent;
    ui.fillText(this.shopName, px + 8, 20, pw - 16);
    ui.font = font(11);
    ui.fillStyle = COLORS.dim;
    ui.fillText("Gold", px + 8, 36);
    ui.textAlign = "right";
    ui.fillStyle = COLORS.text;
    ui.fillText(`${this.rpg.state.gold} G`, px + pw - 8, 36);
    if (this.mode === "buy" && this.list?.current) {
      const id = this.listIds[this.list.cursor];
      ui.textAlign = "left";
      ui.fillStyle = COLORS.dim;
      ui.fillText("Owned", px + 8, 50);
      ui.textAlign = "right";
      ui.fillStyle = COLORS.text;
      ui.fillText(String(this.rpg.state.itemCount(id)), px + pw - 8, 50);
    }

    const text = this.message?.text ?? (this.mode !== "main" ? this.list?.current?.help : this.greeting);
    if (text) {
      drawPanel(ui, 8, H - 30, W - 16, 22);
      ui.font = font(11);
      ui.textAlign = "center";
      ui.fillStyle = this.message ? COLORS.accent : COLORS.text;
      ui.fillText(text, W / 2, H - 18.5, W - 32);
    }
  }
}

function sellPrice(db: Database, id: string): number {
  return Math.floor(thingPrice(db, id) / 2);
}
