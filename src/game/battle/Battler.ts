import type { SpriteSheet } from "../../engine/sprite";
import type { EnemyDef, Range, Row, Stats } from "../data";
import type { PartyMember } from "../state";

export type Side = "party" | "enemy";

/** One combatant in a battle (a party member or an enemy). */
export class Battler {
  hp: number;
  mp: number;
  /** Turn gauge, 0..1. Acts when full. */
  atb: number;
  defending = false;
  /** Enemy has picked an action and is waiting for it to run. */
  queued = false;
  /** Battle row. */
  row: Row = "front";
  /** Position within the row (top to bottom), used for layout and "pierce". */
  lane = 0;
  /** Range of the equipped weapon (enemies: melee unless a skill says otherwise). */
  weaponRange: Range = "melee";
  /** Cover is active: takes single-target physical hits aimed at back-row allies until this battler's next turn. */
  covering = false;

  // ---- visuals ----
  /** Feet position on screen (UI units). */
  homeX = 0;
  homeY = 0;
  offsetX = 0;
  /** Drawn x position; glides toward homeX when changing rows. */
  visualX = NaN;
  flash = 0;
  shake = 0;
  fade = 1;
  /** World pixels per UI unit (set by the battle scene). */
  worldScale = 1;

  constructor(
    readonly side: Side,
    readonly name: string,
    /** Max HP/MP and other stats (refreshed on level-up). */
    public stats: Stats,
    hp: number,
    mp: number,
    readonly skills: string[],
    readonly member?: PartyMember,
    readonly enemy?: EnemyDef,
    readonly sprite?: SpriteSheet,
    readonly image?: HTMLImageElement,
  ) {
    this.hp = hp;
    this.mp = mp;
    // Faster characters start with a fuller gauge, with some randomness.
    this.atb = Math.min(0.9, Math.random() * 0.35 + stats.spd / 60);
  }

  get alive(): boolean {
    return this.hp > 0;
  }

  /** Seconds for an empty gauge to fill: speed 10 = 3s, speed 20 = 2s. */
  get fillRate(): number {
    return (this.stats.spd + 10) / 60;
  }

  /** Art zoom in battle: each art pixel is drawn this many world pixels wide (default 2). */
  get zoom(): number {
    return this.side === "party" ? 2 : this.enemy?.scale ?? 2;
  }

  /** Battle positions are in UI units: UI units per art pixel. */
  get scale(): number {
    return this.zoom / this.worldScale;
  }

  /** Width/height on screen in UI units. */
  get size(): { w: number; h: number } {
    if (this.sprite) return { w: this.sprite.frameW * this.scale, h: this.sprite.frameH * this.scale };
    if (this.image) return { w: this.image.width * this.scale, h: this.image.height * this.scale };
    return { w: 32, h: 32 };
  }

  /** Screen rectangle used for taps and effects. */
  get bounds(): { x: number; y: number; w: number; h: number } {
    const { w, h } = this.size;
    return { x: this.drawX - w / 2, y: this.homeY - h, w, h };
  }

  /** Current on-screen x of the feet (row glide + step-forward). */
  get drawX(): number {
    return (Number.isNaN(this.visualX) ? this.homeX : this.visualX) + this.offsetX;
  }

  get centerX(): number {
    return this.drawX;
  }
  get centerY(): number {
    return this.homeY - this.size.h / 2;
  }
}
