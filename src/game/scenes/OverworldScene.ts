import { assetUrl, loadImage } from "../../engine/assets";
import { Camera } from "../../engine/camera";
import { Scene } from "../../engine/scene";
import { SpriteSheet, type Direction } from "../../engine/sprite";
import type { Rect } from "../../engine/physics";
import { TileMap, type MapObject } from "../../engine/tilemap";
import { BattleScene, type BattleOptions, type BattleResult } from "../battle/BattleScene";
import type { RPG } from "../context";
import { Player } from "../entities/Player";
import { ChoiceScene } from "./ChoiceScene";
import { GameOverScene } from "./GameOverScene";
import { MenuScene } from "./MenuScene";
import { ShopScene } from "./ShopScene";
import { DialogueBox } from "../ui/DialogueBox";

const FADE_SPEED = 4; // full fade in 0.25s
const ENCOUNTER_FLASH = 0.5; // seconds of screen flashing before a battle
const DEFAULT_ENCOUNTER_RATE = 0.1; // chance per tile walked inside a zone
const DEFAULT_MIN_STEPS = 4; // tiles of grace after each battle

type Fade = { dir: 1 | -1; alpha: number; onBlack?: () => Promise<void> };

/** A map object drawn as a character (any object with a `sprite` property: npc, shop, inn...). */
interface Actor {
  obj: MapObject;
  sheet: SpriteSheet;
  facing: Direction;
}

/** A visible enemy placed on the map (object Class "enemy"). */
interface MapEnemy {
  obj: MapObject;
  image: HTMLImageElement;
  /** World flag set when it's beaten, so it stays gone. */
  flag: string;
}

/**
 * Walking around a map: movement, camera, doors between maps, signs, random
 * encounters and visible enemies.
 * Maps live in public/assets/maps/<name>.tmj and are made with Tiled.
 */
export class OverworldScene extends Scene {
  private map: TileMap | null = null;
  private mapName = "";
  private readonly player: Player;
  private readonly cam = new Camera();
  private dialogue: DialogueBox | null = null;
  private afterDialogue: (() => void) | null = null;
  private fade: Fade | null = { dir: -1, alpha: 1 };
  /** Doors only trigger after the player has stepped off every door (prevents ping-pong). */
  private doorArmed = false;
  private error: string | null = null;

  private enemies: MapEnemy[] = [];
  private actors: Actor[] = [];
  /** An enemy you ran from (or lost to) can't re-trigger until you step off it. */
  private ignoreEnemy: MapEnemy | null = null;
  /** Tiles walked inside encounter zones since the last battle. */
  private encounterSteps = 0;
  private encounterDist = 0;
  private lastDistance = 0;
  private flash: { t: number; start: () => void } | null = null;
  /** Hidden passages: A presses so far, and where the player stood for them. */
  private secretPresses = 0;
  private secretAt: { obj: MapObject; x: number; y: number; facing: Direction } | null = null;
  private shake = 0;
  private lastFacing: Direction = "down";
  private time = 0;
  private readonly noEncounters = new URLSearchParams(location.search).has("noencounters");

  constructor(
    private rpg: RPG,
    private startMap: string,
    private startSpawn: string,
    /** Exact start position (when loading a save) instead of a spawn point. */
    private startPos?: { x: number; y: number; facing: Direction },
  ) {
    super(rpg.game);
    const leader = rpg.state.party[0];
    this.player = new Player(rpg.sprites.get(leader.def.sprite)!);
  }

  async enter(): Promise<void> {
    await this.loadMap(this.startMap, this.startSpawn, undefined, this.startPos);
  }

  /** Where the player is, for saving. */
  position(): { map: string; x: number; y: number; facing: Direction } {
    return { map: this.mapName, ...this.player.anchor, facing: this.player.facing };
  }

  private async loadMap(name: string, spawnName: string, facing?: Direction, pos?: { x: number; y: number; facing: Direction }): Promise<void> {
    try {
      const map = await TileMap.load(assetUrl(`assets/maps/${name}.tmj`));
      this.map = map;
      this.mapName = name;
      if (pos) {
        this.player.placeAt(pos.x, pos.y, map.tileW, pos.facing);
      } else {
        const spawn = map.findObject("spawn", spawnName) ?? map.findObject("spawn");
        if (!spawn) throw new Error(`Map "${name}" has no spawn object (Class "spawn").`);
        const c = center(spawn);
        this.player.placeAt(c.x, c.y, map.tileW, (spawn.props.facing as Direction | undefined) ?? facing);
      }
      this.doorArmed = false;
      this.error = null;
      this.encounterSteps = 0;
      this.encounterDist = 0;
      this.lastDistance = this.player.distance;
      this.ignoreEnemy = null;
      // Hidden passages opened earlier stay open.
      for (const o of map.objects) if (o.type === "secret" && this.rpg.state.flags.has(secretFlag(name, o))) this.openSecret(map, o, false);
      this.secretPresses = 0;
      this.secretAt = null;
      this.enemies = await this.loadEnemies(map, name);
      this.actors = await this.loadActors(map);
    } catch (e) {
      console.error(e);
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  private async loadActors(map: TileMap): Promise<Actor[]> {
    const out: Actor[] = [];
    for (const obj of map.objects) {
      const name = obj.props.sprite;
      if (typeof name !== "string" || obj.type === "enemy") continue;
      let sheet = this.rpg.sprites.get(name);
      if (!sheet) {
        sheet = await SpriteSheet.load(assetUrl(`assets/sprites/${name}.json`));
        this.rpg.sprites.set(name, sheet);
      }
      out.push({ obj, sheet, facing: (obj.props.facing as Direction | undefined) ?? "down" });
    }
    return out;
  }

  private async loadEnemies(map: TileMap, mapName: string): Promise<MapEnemy[]> {
    const out: MapEnemy[] = [];
    for (const obj of map.objects) {
      if (obj.type !== "enemy") continue;
      const flag = `defeated:${mapName}:${obj.id}`;
      if (this.rpg.state.flags.has(flag)) continue;
      const ids = enemyList(obj);
      const def = this.rpg.db.enemies[ids[0]];
      if (!def) throw new Error(`Map "${mapName}": enemy object ${obj.id} has unknown enemy "${ids[0]}"`);
      const image = await loadImage(assetUrl(`assets/enemies/${String(obj.props.image ?? def.image)}`));
      out.push({ obj, image, flag });
    }
    return out;
  }

  update(dt: number): void {
    const input = this.game.input;
    this.time += dt;
    this.rpg.state.playTime += dt;
    this.shake = Math.max(0, this.shake - dt);

    if (this.flash) {
      this.flash.t += dt;
      if (this.flash.t >= ENCOUNTER_FLASH) {
        const start = this.flash.start;
        this.flash = null;
        start();
      }
      return;
    }

    if (this.fade) {
      this.fade.alpha += this.fade.dir * FADE_SPEED * dt;
      if (this.fade.dir === 1 && this.fade.alpha >= 1) {
        this.fade.alpha = 1;
        const job = this.fade.onBlack;
        this.fade.onBlack = undefined;
        if (job) job().then(() => this.fade && (this.fade.dir = -1));
      } else if (this.fade.dir === -1 && this.fade.alpha <= 0) {
        this.fade = null;
      }
      if (this.fade && this.fade.dir === 1) return;
    }

    const map = this.map;
    if (!map) return;

    if (this.dialogue) {
      this.dialogue.update(dt, input);
      if (this.dialogue.done) {
        this.dialogue = null;
        const next = this.afterDialogue;
        this.afterDialogue = null;
        next?.();
      }
      return;
    }

    if (input.pressed("menu") && !this.fade) {
      void this.game.scenes.push(new MenuScene(this.rpg, () => this.position()));
      return;
    }

    const blockers = [...this.enemies, ...this.actors].map((e) => enemyBox(e.obj, map.tileW));
    this.player.update(dt, input, map, blockers);
    const moved = this.player.distance - this.lastDistance;
    this.lastDistance = this.player.distance;
    // Any step or turn resets a hidden passage's press count.
    if (moved > 0 || this.player.facing !== this.lastFacing) {
      this.secretPresses = 0;
      this.secretAt = null;
    }
    this.lastFacing = this.player.facing;

    if (input.pressed("confirm")) this.interact(map);
    if (this.dialogue || this.fade?.dir === 1) return;

    // Bumping into a visible enemy
    const b = this.player.body;
    for (const e of this.enemies) {
      const r = grow(enemyBox(e.obj, map.tileW), 2);
      const touching = b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
      if (e === this.ignoreEnemy) {
        if (!touching) this.ignoreEnemy = null;
      } else if (touching) {
        this.engage(e);
        return;
      }
    }

    // Random encounters
    const zone = map.objectsAt(this.player.cx, this.player.cy, "encounter")[0];
    if (zone && moved > 0 && !this.noEncounters) {
      this.encounterDist += moved;
      while (this.encounterDist >= map.tileW) {
        this.encounterDist -= map.tileW;
        this.encounterSteps++;
        const rate = Number(zone.props.rate ?? DEFAULT_ENCOUNTER_RATE);
        const minSteps = Number(zone.props.minSteps ?? DEFAULT_MIN_STEPS);
        if (this.encounterSteps >= minSteps && Math.random() < rate) {
          this.randomEncounter(zone);
          return;
        }
      }
    }

    // Doors (including opened secret passages that lead to another map)
    const doors = map.objectsAt(this.player.cx, this.player.cy).filter(
      (o) => o.type === "door" || (o.type === "secret" && o.props.map && this.rpg.state.flags.has(secretFlag(this.mapName, o))),
    );
    if (doors.length === 0) this.doorArmed = true;
    else if (this.doorArmed && !this.fade) this.useDoor(doors[0]);
  }

  private interact(map: TileMap): void {
    const p = this.player.facingPoint();
    const enemy = this.enemies.find((e) => p.x >= e.obj.x && p.x < e.obj.x + e.obj.width && p.y >= e.obj.y && p.y < e.obj.y + e.obj.height);
    if (enemy) return this.engage(enemy);
    const target = map.objectsAt(p.x, p.y).find((o) => ["sign", "npc", "battle", "shop", "inn"].includes(o.type));
    if (!target) {
      const secret = map.objectsAt(p.x, p.y, "secret").find((o) => !this.rpg.state.flags.has(secretFlag(this.mapName, o)));
      if (secret) this.pressSecret(map, secret);
      return;
    }
    // Characters turn to face you when you talk to them.
    const actor = this.actors.find((a) => a.obj === target);
    if (actor) actor.facing = ({ up: "down", down: "up", left: "right", right: "left" } as const)[this.player.facing];
    if (target.type === "shop") {
      const stock = String(target.props.items ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      void this.game.scenes.push(new ShopScene(this.rpg, target.name || "Shop", stock, String(target.props.text ?? "Welcome!")));
      return;
    }
    if (target.type === "inn") return this.inn(target);
    if (target.type === "battle") {
      const fight = () => this.startBattle(String(target.props.enemies ?? "slime").split(",").map((s) => s.trim()), {
        canFlee: target.props.canFlee !== false,
      });
      if (target.props.text) {
        this.dialogue = new DialogueBox(String(target.props.text).split("|"));
        this.afterDialogue = fight;
      } else fight();
      return;
    }
    const text = String(target.props.text ?? "...");
    const speaker = target.type === "npc" ? target.name || undefined : undefined;
    this.dialogue = new DialogueBox(text.split("|"), speaker);
  }

  /**
   * Hidden passage: press A `presses` times (default 3) while facing it,
   * without moving or turning in between. Moving resets the count.
   */
  private pressSecret(map: TileMap, obj: MapObject): void {
    const { x, y } = this.player.anchor;
    const facing = this.player.facing;
    const prev = this.secretAt;
    const still = prev && prev.obj === obj && prev.facing === facing && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5;
    this.secretPresses = still ? this.secretPresses + 1 : 1;
    this.secretAt = { obj, x, y, facing };
    if (this.secretPresses < Number(obj.props.presses ?? 3)) return;
    this.secretPresses = 0;
    this.secretAt = null;
    this.rpg.state.flags.add(secretFlag(this.mapName, obj));
    this.openSecret(map, obj, true);
  }

  private openSecret(map: TileMap, obj: MapObject, announce: boolean): void {
    const gid = obj.props.tile ? map.tileByName(String(obj.props.tile)) : 0;
    map.openArea(obj.x, obj.y, obj.width, obj.height, gid);
    if (!announce) return;
    this.shake = 0.45;
    this.dialogue = new DialogueBox(String(obj.props.text ?? "Something clicked... a hidden passage opened!").split("|"));
  }

  /** Inn: pay to fully restore the party. */
  private inn(obj: MapObject): void {
    const price = Number(obj.props.price ?? 10);
    const state = this.rpg.state;
    const speaker = obj.name || undefined;
    void this.game.scenes.push(
      new ChoiceScene(this.game, `${String(obj.props.text ?? "Rest for the night?")} (${price} gold)`, ["Yes", "No"], (i) => {
        if (i !== 0) return;
        if (state.gold < price) {
          this.dialogue = new DialogueBox(["You don't have enough gold."], speaker);
          return;
        }
        state.gold -= price;
        this.fade = {
          dir: 1,
          alpha: 0,
          onBlack: async () => {
            state.restoreParty(this.rpg.db);
            await new Promise((r) => setTimeout(r, 400));
            this.dialogue = new DialogueBox(["You feel well rested. HP and MP restored!"], speaker);
          },
        };
      }),
    );
  }

  /** Starts a fight with a visible map enemy (after its line of dialogue, if any). */
  private engage(e: MapEnemy): void {
    const fight = () =>
      this.withFlash(() =>
        this.startBattle(enemyList(e.obj), { canFlee: e.obj.props.canFlee !== false }, (result) => {
          if (result === "victory") {
            this.rpg.state.flags.add(e.flag);
            this.enemies = this.enemies.filter((x) => x !== e);
          } else {
            this.ignoreEnemy = e;
          }
        }),
      );
    this.ignoreEnemy = e;
    if (e.obj.props.text) {
      this.dialogue = new DialogueBox(String(e.obj.props.text).split("|"), e.obj.name || undefined);
      this.afterDialogue = fight;
    } else fight();
  }

  private randomEncounter(zone: MapObject): void {
    const tableId = String(zone.props.table ?? zone.name);
    const table = this.rpg.db.encounters[tableId];
    if (!table || table.groups.length === 0) {
      console.warn(`Encounter zone "${zone.name}" uses unknown table "${tableId}" (public/data/encounters.json)`);
      return;
    }
    const total = table.groups.reduce((s, g) => s + g.weight, 0);
    let r = Math.random() * total;
    const group = table.groups.find((g) => (r -= g.weight) <= 0) ?? table.groups[0];
    this.withFlash(() => this.startBattle(group.enemies));
  }

  /** Flashes the screen briefly (the "encounter!" cue), then runs `start`. */
  private withFlash(start: () => void): void {
    this.flash = { t: 0, start };
  }

  /** Fades out, runs a battle on top of this scene, then fades back in. */
  startBattle(enemyIds: string[], options: BattleOptions = {}, onResult?: (r: BattleResult) => void): void {
    if (this.fade?.dir === 1) return; // already leaving
    this.fade = {
      dir: 1,
      alpha: this.fade?.alpha ?? 0,
      onBlack: () =>
        this.game.scenes.push(
          new BattleScene(this.rpg, enemyIds, options, (result: BattleResult) => {
            if (result === "defeat") {
              void this.game.scenes.push(new GameOverScene(this.rpg));
              return;
            }
            this.encounterSteps = 0;
            this.encounterDist = 0;
            this.game.input.reset();
            onResult?.(result);
          }),
        ),
    };
  }

  private useDoor(door: MapObject): void {
    const targetMap = String(door.props.map ?? this.mapName);
    const targetSpawn = String(door.props.spawn ?? "");
    const facing = this.player.facing;
    this.doorArmed = false;
    this.fade = { dir: 1, alpha: 0, onBlack: () => this.loadMap(targetMap, targetSpawn, facing) };
  }

  render(world: CanvasRenderingContext2D, ui: CanvasRenderingContext2D): void {
    const d = this.game.display;
    const map = this.map;
    if (map) {
      this.cam.follow(this.player.cx, this.player.cy, d.width, d.height, map.pixelWidth, map.pixelHeight);
      if (this.shake > 0) {
        const k = Math.min(1, this.shake / 0.2) * (map.tileW / 8);
        this.cam.x += Math.round((Math.random() - 0.5) * 2 * k);
        this.cam.y += Math.round((Math.random() - 0.5) * 2 * k);
      }
      map.draw(world, this.cam, false);
      // Characters back-to-front, so whoever is lower on screen is drawn in front.
      const playerFeet = this.player.body.y + this.player.body.h;
      const things: (MapEnemy | Actor)[] = [...this.enemies, ...this.actors];
      things.sort((a, b) => a.obj.y + a.obj.height - (b.obj.y + b.obj.height));
      let playerDrawn = false;
      for (const e of things) {
        if (!playerDrawn && e.obj.y + e.obj.height > playerFeet) {
          this.player.render(world, this.cam);
          playerDrawn = true;
        }
        if ("sheet" in e) this.drawActor(world, e);
        else this.drawEnemy(world, e, map.tileW);
      }
      if (!playerDrawn) this.player.render(world, this.cam);
      map.draw(world, this.cam, true);
      if (this.game.debug) {
        map.drawDebug(world, this.cam);
        world.strokeStyle = "#ff0";
        const b = this.player.body;
        world.strokeRect(Math.round(b.x - this.cam.x) + 0.5, Math.round(b.y - this.cam.y) + 0.5, b.w - 1, b.h - 1);
      }
    }

    this.dialogue?.render(ui, d.uiWidth, d.uiHeight);

    if (this.flash) {
      // Two quick white flashes
      const phase = (this.flash.t / ENCOUNTER_FLASH) * 4;
      ui.fillStyle = `rgba(255,255,255,${Math.floor(phase) % 2 === 0 ? 0.75 * (1 - (phase % 1)) : 0})`;
      ui.fillRect(0, 0, d.uiWidth, d.uiHeight);
    }

    if (this.fade) {
      ui.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, this.fade.alpha))})`;
      ui.fillRect(0, 0, d.uiWidth, d.uiHeight);
    }

    if (this.error) {
      ui.fillStyle = "rgba(120,0,0,0.9)";
      ui.fillRect(8, 8, d.uiWidth - 16, 40);
      ui.fillStyle = "#fff";
      ui.font = "9px monospace";
      ui.textAlign = "left";
      ui.textBaseline = "top";
      ui.fillText("Map error:", 14, 14);
      ui.fillText(this.error.slice(0, 80), 14, 28);
    }
  }

  private drawActor(ctx: CanvasRenderingContext2D, a: Actor): void {
    const o = a.obj;
    const x = Math.round(o.x + o.width / 2 - a.sheet.frameW / 2 - this.cam.x);
    const y = Math.round(o.y + o.height - a.sheet.frameH - this.cam.y);
    a.sheet.draw(ctx, a.facing, 0, x, y);
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: MapEnemy, tile: number): void {
    const o = e.obj;
    // Drawn `size` tiles tall (default 1), standing on the bottom of its object rectangle.
    const h = tile * Number(o.props.size ?? 1);
    const w = (e.image.width / e.image.height) * h;
    const bob = Math.round(Math.sin(this.time * 3 + o.id) * (tile / 16));
    const x = Math.round(o.x + o.width / 2 - w / 2 - this.cam.x);
    const y = Math.round(o.y + o.height - h - this.cam.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h - 1, w * 0.3, tile / 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(e.image, x, y + bob, w, h);
  }
}

function secretFlag(mapName: string, o: MapObject): string {
  return `secret:${mapName}:${o.id}`;
}

function enemyList(o: MapObject): string[] {
  return String(o.props.enemies ?? o.name ?? "slime").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Solid area of a map enemy: most of its rectangle (a little open at the top for overlap with heads). */
function enemyBox(o: MapObject, tile: number): Rect {
  const inset = tile * 0.1;
  return { x: o.x + inset, y: o.y + tile * 0.25, w: o.width - inset * 2, h: o.height - tile * 0.25 - 1 };
}

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + by * 2, h: r.h + by * 2 };
}

function center(o: MapObject): { x: number; y: number } {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}
