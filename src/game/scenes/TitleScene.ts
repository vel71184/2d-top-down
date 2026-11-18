import { Scene } from "../../engine/scene";
import type { RPG } from "../context";
import { continueFromSave, startNewGame } from "../flow";
import { describeSave, latestSlot, readSave, SAVE_SLOTS } from "../save";
import { Menu } from "../ui/Menu";
import { COLORS, drawPanel, font, outlinedText } from "../ui/theme";

/** Title screen: Continue / New Game / Load Game. */
export class TitleScene extends Scene {
  private menu: Menu;
  private slots: Menu | null = null;
  private time = 0;
  private busy = false;
  private readonly latest = latestSlot();

  constructor(private rpg: RPG) {
    super(rpg.game);
    const hasSave = this.latest !== null;
    this.menu = new Menu(
      [{ label: "Continue", disabled: !hasSave }, { label: "New Game" }, { label: "Load Game", disabled: !hasSave }],
      0, 0, 120, 3 * 22 + 8, 1, 22,
    );
    this.menu.cursor = hasSave ? 0 : 1;
  }

  enter(): void {
    this.game.input.reset();
  }

  update(dt: number): void {
    this.time += dt;
    if (this.busy) return;
    const input = this.game.input;
    if (this.slots) {
      const r = this.slots.update(input, false);
      if (r?.type === "cancel") this.slots = null;
      else if (r?.type === "select") {
        const d = readSave(r.index);
        if (d) this.go(() => continueFromSave(this.rpg, d));
      }
      return;
    }
    const r = this.menu.update(input, false);
    if (r?.type !== "select") return;
    if (r.index === 0 && this.latest !== null) {
      const d = readSave(this.latest);
      if (d) this.go(() => continueFromSave(this.rpg, d));
    } else if (r.index === 1) {
      this.go(() => startNewGame(this.rpg).then(() => undefined));
    } else if (r.index === 2) {
      const items = [];
      for (let i = 0; i < SAVE_SLOTS; i++) {
        const d = readSave(i);
        items.push({ label: `Slot ${i + 1}`, right: d ? describeSave(this.rpg.db, d) : "— empty —", disabled: !d });
      }
      this.slots = new Menu(items, 0, 0, 280, SAVE_SLOTS * 22 + 8, 1, 22);
    }
  }

  private go(start: () => Promise<void>): void {
    this.busy = true;
    void start();
  }

  render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const d = this.game.display;
    const W = d.uiWidth, H = d.uiHeight;
    // Background
    const g = world.createLinearGradient(0, 0, 0, d.height);
    g.addColorStop(0, "#1b2450");
    g.addColorStop(0.6, "#3a5fa8");
    g.addColorStop(1, "#4f8a52");
    world.fillStyle = g;
    world.fillRect(0, 0, d.width, d.height);
    // Party walking across the bottom
    world.imageSmoothingEnabled = false;
    const s = d.worldScale;
    this.rpg.state.party.forEach((m, i) => {
      const sheet = this.rpg.sprites.get(m.def.sprite);
      if (!sheet) return;
      const zoom = 2;
      const x = W / 2 + (i - 1) * 40;
      sheet.draw(world, "down", this.time + i * 0.2, Math.round((x * s) - (sheet.frameW * zoom) / 2), Math.round((H - 22) * s - sheet.frameH * zoom), zoom);
    });

    ui.textAlign = "center";
    ui.textBaseline = "middle";
    ui.font = font(28, true);
    outlinedText(ui, "Top-Down RPG", W / 2, 44, COLORS.accent);
    ui.font = font(10);
    outlinedText(ui, "working title", W / 2, 66, COLORS.text);

    Object.assign(this.menu, { x: (W - this.menu.w) / 2, y: 84 });
    this.menu.render(ui, !this.slots);
    if (this.slots) {
      Object.assign(this.slots, { x: (W - this.slots.w) / 2, y: 84 });
      this.slots.render(ui);
      drawPanel(ui, (W - 160) / 2, 84 + this.slots.h + 4, 160, 18);
      ui.font = font(9);
      ui.fillStyle = COLORS.dim;
      ui.textAlign = "center";
      ui.fillText("Choose a save · B to go back", W / 2, 84 + this.slots.h + 13);
    }
  }
}
