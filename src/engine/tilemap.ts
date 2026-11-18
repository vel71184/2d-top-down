import { loadImage, loadJson } from "./assets";
import type { Camera } from "./camera";

// ---------- Tiled JSON types (the subset we use) ----------
interface TiledProperty { name: string; type: string; value: unknown }
interface TiledTile { id: number; properties?: TiledProperty[] }
interface TiledTilesetData {
  columns: number;
  image: string;
  imagewidth: number;
  imageheight: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  margin?: number;
  spacing?: number;
  tiles?: TiledTile[];
}
interface TiledTilesetRef { firstgid: number; source?: string }
interface TiledObject {
  id: number;
  name: string;
  type?: string;
  class?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  point?: boolean;
  properties?: TiledProperty[];
}
interface TiledLayer {
  name: string;
  type: "tilelayer" | "objectgroup" | "imagelayer" | "group";
  visible: boolean;
  opacity?: number;
  data?: number[];
  objects?: TiledObject[];
  properties?: TiledProperty[];
}
interface TiledMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite?: boolean;
  layers: TiledLayer[];
  tilesets: (TiledTilesetRef & Partial<TiledTilesetData>)[];
  properties?: TiledProperty[];
}

export type Props = Record<string, unknown>;

function propsOf(list?: TiledProperty[]): Props {
  const out: Props = {};
  for (const p of list ?? []) out[p.name] = p.value;
  return out;
}

// Tiled stores flip/rotation flags in the top bits of each tile id.
const GID_MASK = 0x0fffffff;

// ---------- runtime types ----------
export interface MapObject {
  id: number;
  name: string;
  /** Object "Class" in Tiled (spawn, door, sign, encounter, ...). */
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  props: Props;
}

interface Tileset {
  firstgid: number;
  columns: number;
  tileW: number;
  tileH: number;
  margin: number;
  spacing: number;
  tilecount: number;
  image: HTMLImageElement;
  tileProps: Map<number, Props>;
}

interface TileLayer {
  name: string;
  data: Uint32Array;
  visible: boolean;
  opacity: number;
  /** Drawn on top of characters (e.g. tree canopies, roof edges). */
  above: boolean;
}

/**
 * A map made in Tiled (https://www.mapeditor.org), saved as JSON (.tmj).
 *
 * Conventions:
 *  - Tile layers before the first object layer draw below characters,
 *    layers after it draw above. A layer property `above` (bool) overrides this.
 *  - A tile is solid if its tileset tile has property `solid = true`.
 *  - A tile layer with property `collision = true` (or named "collision") is
 *    invisible; any tile painted on it is solid.
 *  - Objects use their Class field as `type`: spawn, door, sign, encounter...
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly tileW: number;
  readonly tileH: number;
  readonly props: Props;
  readonly objects: MapObject[] = [];
  private layers: TileLayer[] = [];
  private solid: Uint8Array;
  /** Cells blocked by a "collision" layer (kept separately so tile changes can recompute `solid`). */
  private collision: Uint8Array;

  private constructor(data: TiledMap, private tilesets: Tileset[]) {
    this.width = data.width;
    this.height = data.height;
    this.tileW = data.tilewidth;
    this.tileH = data.tileheight;
    this.props = propsOf(data.properties);
    this.solid = new Uint8Array(this.width * this.height);
    this.collision = new Uint8Array(this.width * this.height);

    let seenObjects = false;
    for (const layer of flattenLayers(data.layers)) {
      if (layer.type === "objectgroup") {
        seenObjects = true;
        for (const o of layer.objects ?? []) {
          this.objects.push({
            id: o.id,
            name: o.name ?? "",
            type: o.type || o.class || "",
            x: o.x,
            y: o.y,
            width: o.width,
            height: o.height,
            props: propsOf(o.properties),
          });
        }
      } else if (layer.type === "tilelayer" && layer.data) {
        const lp = propsOf(layer.properties);
        const isCollision = lp.collision === true || layer.name.toLowerCase() === "collision";
        const tiles = Uint32Array.from(layer.data, (g) => g & GID_MASK);
        tiles.forEach((gid, i) => {
          if (!gid) return;
          if (isCollision) this.collision[i] = 1;
          if (isCollision || this.tileProp(gid, "solid") === true) this.solid[i] = 1;
        });
        if (!isCollision) {
          this.layers.push({
            name: layer.name,
            data: tiles,
            visible: layer.visible,
            opacity: layer.opacity ?? 1,
            above: typeof lp.above === "boolean" ? lp.above : seenObjects,
          });
        }
      }
    }
  }

  static async load(url: string): Promise<TileMap> {
    const data = await loadJson<TiledMap>(url);
    if (data.infinite) throw new Error(`${url}: infinite maps are not supported (uncheck "Infinite" in Tiled).`);
    const tilesets = await Promise.all(
      data.tilesets.map(async (ref) => {
        let tsData: TiledTilesetData;
        let base = url;
        if (ref.source) {
          base = new URL(ref.source, url).href;
          tsData = await loadJson<TiledTilesetData>(base);
        } else {
          tsData = ref as TiledTilesetData;
        }
        const image = await loadImage(new URL(tsData.image, base).href);
        const tileProps = new Map<number, Props>();
        for (const t of tsData.tiles ?? []) tileProps.set(t.id, propsOf(t.properties));
        return {
          firstgid: ref.firstgid,
          columns: tsData.columns,
          tileW: tsData.tilewidth,
          tileH: tsData.tileheight,
          margin: tsData.margin ?? 0,
          spacing: tsData.spacing ?? 0,
          tilecount: tsData.tilecount,
          image,
          tileProps,
        } satisfies Tileset;
      }),
    );
    tilesets.sort((a, b) => a.firstgid - b.firstgid);
    return new TileMap(data, tilesets);
  }

  get pixelWidth(): number {
    return this.width * this.tileW;
  }
  get pixelHeight(): number {
    return this.height * this.tileH;
  }

  private tilesetFor(gid: number): Tileset | undefined {
    for (let i = this.tilesets.length - 1; i >= 0; i--) if (gid >= this.tilesets[i].firstgid) return this.tilesets[i];
    return undefined;
  }

  tileProp(gid: number, name: string): unknown {
    const ts = this.tilesetFor(gid);
    return ts?.tileProps.get(gid - ts.firstgid)?.[name];
  }

  /** Solid tiles, plus everything outside the map, block movement. */
  isSolidTile(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) return true;
    return this.solid[ty * this.width + tx] === 1;
  }

  /** True if any part of the rectangle overlaps a solid tile. */
  rectHitsSolid(x: number, y: number, w: number, h: number): boolean {
    const x0 = Math.floor(x / this.tileW), x1 = Math.floor((x + w - 0.001) / this.tileW);
    const y0 = Math.floor(y / this.tileH), y1 = Math.floor((y + h - 0.001) / this.tileH);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.isSolidTile(tx, ty)) return true;
    return false;
  }

  /** Finds a tile by its `name` property in the tileset (e.g. "door"); returns its global id or 0. */
  tileByName(name: string): number {
    for (const ts of this.tilesets)
      for (const [id, props] of ts.tileProps) if (props.name === name) return ts.firstgid + id;
    return 0;
  }

  /**
   * Opens up a rectangle of the map (hidden passages): every solid tile in it is
   * replaced with `gid` (or removed when 0) and the area becomes walkable.
   */
  openArea(px: number, py: number, pw: number, ph: number, gid = 0): void {
    const x0 = Math.floor(px / this.tileW), y0 = Math.floor(py / this.tileH);
    const x1 = Math.ceil((px + pw) / this.tileW) - 1, y1 = Math.ceil((py + ph) / this.tileH) - 1;
    for (let ty = Math.max(0, y0); ty <= Math.min(this.height - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(this.width - 1, x1); tx++) {
        const i = ty * this.width + tx;
        let replaced = false;
        // Replace the top-most solid tile; remove solid tiles beneath it.
        for (let l = this.layers.length - 1; l >= 0; l--) {
          const layer = this.layers[l];
          const g = layer.data[i];
          if (!g || this.tileProp(g, "solid") !== true) continue;
          layer.data[i] = !replaced && gid ? gid : 0;
          replaced = true;
        }
        this.collision[i] = 0;
        this.solid[i] = this.layers.some((l) => l.data[i] && this.tileProp(l.data[i], "solid") === true) ? 1 : 0;
      }
    }
  }

  findObject(type: string, name?: string): MapObject | undefined {
    return this.objects.find((o) => o.type === type && (name === undefined || o.name === name));
  }

  objectsAt(px: number, py: number, type?: string): MapObject[] {
    return this.objects.filter(
      (o) => (!type || o.type === type) && px >= o.x && px < o.x + o.width && py >= o.y && py < o.y + o.height,
    );
  }

  draw(ctx: CanvasRenderingContext2D, cam: Camera, above: boolean): void {
    const cx = Math.round(cam.x), cy = Math.round(cam.y);
    const x0 = Math.max(0, Math.floor(cx / this.tileW));
    const y0 = Math.max(0, Math.floor(cy / this.tileH));
    const x1 = Math.min(this.width - 1, Math.floor((cx + cam.viewW) / this.tileW));
    const y1 = Math.min(this.height - 1, Math.floor((cy + cam.viewH) / this.tileH));
    for (const layer of this.layers) {
      if (!layer.visible || layer.above !== above) continue;
      ctx.globalAlpha = layer.opacity;
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const gid = layer.data[ty * this.width + tx];
          if (!gid) continue;
          const ts = this.tilesetFor(gid);
          if (!ts) continue;
          const local = gid - ts.firstgid;
          const sx = ts.margin + (local % ts.columns) * (ts.tileW + ts.spacing);
          const sy = ts.margin + Math.floor(local / ts.columns) * (ts.tileH + ts.spacing);
          // Tiles taller than the grid (e.g. big trees) are anchored at their bottom-left, like in Tiled.
          ctx.drawImage(
            ts.image, sx, sy, ts.tileW, ts.tileH,
            tx * this.tileW - cx, (ty + 1) * this.tileH - ts.tileH - cy, ts.tileW, ts.tileH,
          );
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Debug overlay: solid tiles and objects. */
  drawDebug(ctx: CanvasRenderingContext2D, cam: Camera): void {
    const cx = Math.round(cam.x), cy = Math.round(cam.y);
    ctx.fillStyle = "rgba(255,0,0,0.25)";
    for (let ty = 0; ty < this.height; ty++)
      for (let tx = 0; tx < this.width; tx++)
        if (this.solid[ty * this.width + tx]) ctx.fillRect(tx * this.tileW - cx, ty * this.tileH - cy, this.tileW, this.tileH);
    ctx.strokeStyle = "rgba(0,200,255,0.9)";
    for (const o of this.objects) ctx.strokeRect(o.x - cx + 0.5, o.y - cy + 0.5, Math.max(1, o.width - 1), Math.max(1, o.height - 1));
  }
}

function flattenLayers(layers: TiledLayer[]): TiledLayer[] {
  const out: TiledLayer[] = [];
  for (const l of layers) {
    if (l.type === "group") out.push(...flattenLayers((l as unknown as { layers: TiledLayer[] }).layers ?? []));
    else out.push(l);
  }
  return out;
}
