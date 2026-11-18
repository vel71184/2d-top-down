import { assetUrl } from "../../engine/assets";
import { Camera } from "../../engine/camera";
import { Scene } from "../../engine/scene";
import type { Direction } from "../../engine/sprite";
import { TileMap, type MapObject } from "../../engine/tilemap";
import { BattleScene, type BattleOptions, type BattleResult } from "../battle/BattleScene";
import type { RPG } from "../context";
import { Player } from "../entities/Player";
import { MenuScene } from "./MenuScene";
import { DialogueBox } from "../ui/DialogueBox";

const FADE_SPEED = 4; // full fade in 0.25s

type Fade = { dir: 1 | -1; alpha: number; onBlack?: () => Promise<void> };

/**
 * Walking around a map: movement, camera, doors between maps, signs and fights.
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

  constructor(private rpg: RPG, private startMap: string, private startSpawn: string) {
    super(rpg.game);
    const leader = rpg.state.party[0];
    this.player = new Player(rpg.sprites.get(leader.def.sprite)!);
  }

  async enter(): Promise<void> {
    await this.loadMap(this.startMap, this.startSpawn);
  }

  private async loadMap(name: string, spawnName: string, facing?: Direction): Promise<void> {
    try {
      const map = await TileMap.load(assetUrl(`assets/maps/${name}.tmj`));
      const spawn = map.findObject("spawn", spawnName) ?? map.findObject("spawn");
      if (!spawn) throw new Error(`Map "${name}" has no spawn object (Class "spawn").`);
      this.map = map;
      this.mapName = name;
      const c = center(spawn);
      this.player.placeAt(c.x, c.y, map.tileW, (spawn.props.facing as Direction | undefined) ?? facing);
      this.doorArmed = false;
      this.error = null;
    } catch (e) {
      console.error(e);
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  update(dt: number): void {
    const input = this.game.input;

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
      void this.game.scenes.push(new MenuScene(this.rpg));
      return;
    }

    this.player.update(dt, input, map);

    if (input.pressed("confirm")) this.interact(map);

    // Doors
    const doors = map.objectsAt(this.player.cx, this.player.cy, "door");
    if (doors.length === 0) this.doorArmed = true;
    else if (this.doorArmed && !this.fade) this.useDoor(doors[0]);
  }

  private interact(map: TileMap): void {
    const p = this.player.facingPoint();
    const target = map.objectsAt(p.x, p.y).find((o) => ["sign", "npc", "battle"].includes(o.type));
    if (!target) return;
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

  /** Fades out, runs a battle on top of this scene, then fades back in. */
  startBattle(enemyIds: string[], options: BattleOptions = {}): void {
    if (this.fade?.dir === 1) return; // already leaving
    this.fade = {
      dir: 1,
      alpha: this.fade?.alpha ?? 0,
      onBlack: () =>
        this.game.scenes.push(
          new BattleScene(this.rpg, enemyIds, options, (result: BattleResult) => {
            if (result === "defeat") this.rpg.state.restoreParty();
            this.game.input.reset();
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
      map.draw(world, this.cam, false);
      this.player.render(world, this.cam);
      map.draw(world, this.cam, true);
      if (this.game.debug) {
        map.drawDebug(world, this.cam);
        world.strokeStyle = "#ff0";
        const b = this.player.body;
        world.strokeRect(Math.round(b.x - this.cam.x) + 0.5, Math.round(b.y - this.cam.y) + 0.5, b.w - 1, b.h - 1);
      }
    }

    this.dialogue?.render(ui, d.uiWidth, d.uiHeight);

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
}

function center(o: MapObject): { x: number; y: number } {
  return { x: o.x + o.width / 2, y: o.y + o.height / 2 };
}
