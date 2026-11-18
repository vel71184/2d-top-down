// Generates simple placeholder pixel art so the game runs before real art exists.
// Usage: npm run art
// Replace the generated PNGs with your own art any time (keep the same grid layout,
// or update the tileset/sprite files to match).
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname } from "node:path";

// ---------- tiny PNG encoder ----------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(img) {
  const { w, h, px } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- drawing helpers ----------
const image = (w, h) => ({ w, h, px: Buffer.alloc(w * h * 4) });
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function pset(img, x, y, color) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const [r, g, b, a] = typeof color === "string" ? hex(color) : color;
  const i = (y * img.w + x) * 4;
  img.px[i] = r;
  img.px[i + 1] = g;
  img.px[i + 2] = b;
  img.px[i + 3] = a;
}
function rect(img, x, y, w, h, color) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pset(img, x + i, y + j, color);
}
function disc(img, cx, cy, r, color) {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) pset(img, cx + x, cy + y, color);
}
let seed = 1234;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
function speckle(img, ox, oy, colors, count) {
  for (let i = 0; i < count; i++)
    pset(img, ox + Math.floor(rand() * 16), oy + Math.floor(rand() * 16), colors[i % colors.length]);
}

// ---------- tileset ----------
// Keep this list in sync with public/assets/tilesets/overworld.tsj (solid flags).
const T = 16;
const COLS = 8;
const tiles = [
  "grass", "flowers", "tallgrass", "path", "water", "tree", "stonewall", "floor",
  "roof", "housewall", "door", "sign", "rock", "void", "rug", "table",
];
const ts = image(COLS * T, Math.ceil(tiles.length / COLS) * T);
const GRASS = "#4f9a3c";

const draw = {
  grass(x, y) {
    rect(ts, x, y, T, T, GRASS);
    speckle(ts, x, y, ["#5fae48", "#3f8530"], 22);
  },
  flowers(x, y) {
    draw.grass(x, y);
    for (const [fx, fy, c] of [[3, 4, "#f2e15b"], [11, 3, "#f07aa8"], [7, 10, "#ffffff"], [13, 12, "#f2e15b"], [2, 13, "#f07aa8"]]) {
      pset(ts, x + fx, y + fy, c);
      pset(ts, x + fx + 1, y + fy, c);
      pset(ts, x + fx, y + fy + 1, c);
      pset(ts, x + fx + 1, y + fy + 1, "#c9a43a");
    }
  },
  tallgrass(x, y) {
    rect(ts, x, y, T, T, "#3f8530");
    for (let i = 0; i < 8; i++) {
      const bx = x + 1 + i * 2;
      const by = y + 3 + (i % 3) * 4;
      rect(ts, bx, by, 1, 5, "#6cc04f");
      pset(ts, bx, by - 1, "#8bd86a");
    }
  },
  path(x, y) {
    rect(ts, x, y, T, T, "#c8a76a");
    speckle(ts, x, y, ["#b39257", "#d8bb83", "#a3834a"], 18);
  },
  water(x, y) {
    rect(ts, x, y, T, T, "#2f6fc0");
    for (const [wx, wy] of [[2, 3], [9, 6], [4, 11], [11, 13]]) rect(ts, x + wx, y + wy, 4, 1, "#7fb6ef");
  },
  tree(x, y) {
    rect(ts, x + 6, y + 10, 4, 6, "#6b4423");
    disc(ts, x + 8, y + 7, 6, "#2d6b2a");
    disc(ts, x + 7, y + 6, 4, "#3e8a37");
    pset(ts, x + 5, y + 4, "#5aa84f");
    pset(ts, x + 6, y + 4, "#5aa84f");
  },
  stonewall(x, y) {
    rect(ts, x, y, T, T, "#7d7d86");
    for (let row = 0; row < 4; row++) {
      rect(ts, x, y + row * 4 + 3, T, 1, "#55555d");
      const off = row % 2 ? 4 : 0;
      for (let c = off; c < T; c += 8) rect(ts, x + c, y + row * 4, 1, 3, "#55555d");
    }
  },
  floor(x, y) {
    rect(ts, x, y, T, T, "#a8743f");
    for (let row = 0; row < 4; row++) rect(ts, x, y + row * 4 + 3, T, 1, "#82572c");
    for (let row = 0; row < 4; row++) pset(ts, x + ((row * 5) % 14) + 1, y + row * 4 + 1, "#bf8a52");
  },
  roof(x, y) {
    rect(ts, x, y, T, T, "#a8403a");
    for (let row = 0; row < 4; row++) {
      rect(ts, x, y + row * 4 + 3, T, 1, "#7c2b27");
      const off = row % 2 ? 3 : 0;
      for (let c = off; c < T; c += 6) pset(ts, x + c, y + row * 4 + 1, "#c7605a");
    }
  },
  housewall(x, y) {
    rect(ts, x, y, T, T, "#e3d4b0");
    rect(ts, x, y + 15, T, 1, "#a8977a");
    rect(ts, x + 4, y + 4, 8, 6, "#6aa6d8");
    rect(ts, x + 7, y + 4, 1, 6, "#e3d4b0");
    rect(ts, x + 4, y + 6, 8, 1, "#e3d4b0");
  },
  door(x, y) {
    rect(ts, x, y, T, T, "#e3d4b0");
    rect(ts, x + 3, y + 2, 10, 14, "#6b4423");
    rect(ts, x + 4, y + 3, 8, 13, "#8a5a2e");
    pset(ts, x + 10, y + 9, "#f2d35b");
  },
  sign(x, y) {
    rect(ts, x + 7, y + 9, 2, 7, "#6b4423");
    rect(ts, x + 2, y + 3, 12, 7, "#8a5a2e");
    rect(ts, x + 3, y + 4, 10, 5, "#b98446");
    for (let i = 0; i < 3; i++) rect(ts, x + 4, y + 5 + i * 1.5 | 0, 7 - i * 2, 1, "#6b4423");
  },
  rock(x, y) {
    disc(ts, x + 8, y + 10, 5, "#6d6d73");
    disc(ts, x + 7, y + 9, 3, "#8e8e96");
    pset(ts, x + 6, y + 7, "#b0b0b8");
  },
  void(x, y) {
    rect(ts, x, y, T, T, "#14121c");
  },
  rug(x, y) {
    rect(ts, x, y, T, T, "#7a2d52");
    rect(ts, x + 1, y + 1, 14, 14, "#9a3c6a");
    rect(ts, x + 3, y + 3, 10, 10, "#7a2d52");
    rect(ts, x + 5, y + 5, 6, 6, "#d8a23f");
  },
  table(x, y) {
    rect(ts, x + 1, y + 4, 14, 8, "#6b4423");
    rect(ts, x + 2, y + 5, 12, 6, "#8a5a2e");
    rect(ts, x + 2, y + 12, 2, 4, "#5a381c");
    rect(ts, x + 12, y + 12, 2, 4, "#5a381c");
  },
};
tiles.forEach((name, i) => draw[name]((i % COLS) * T, Math.floor(i / COLS) * T));

// ---------- hero sprite sheet ----------
// 4 columns (walk frames: stand, step, stand, step) x 4 rows (down, left, right, up).
const hero = image(4 * T, 4 * T);
const SKIN = "#f1c79a", HAIR = "#5a3a1e", TUNIC = "#3a6fd0", TUNIC_D = "#28509c", BOOT = "#3b2a1a", OUT = "#1c1a24";
function drawHero(ox, oy, dir, frame) {
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  // shadow
  rect(hero, ox + 4, oy + 15, 8, 1, [0, 0, 0, 70]);
  // legs
  const lx = ox + 5, rx = ox + 9;
  rect(hero, lx, oy + 12 - (step > 0 ? 1 : 0), 2, 3, BOOT);
  rect(hero, rx, oy + 12 - (step < 0 ? 1 : 0), 2, 3, BOOT);
  // body
  rect(hero, ox + 4, oy + 8, 8, 5, TUNIC);
  rect(hero, ox + 4, oy + 12, 8, 1, TUNIC_D);
  // arms
  if (dir === "left" || dir === "right") {
    rect(hero, ox + 7 + step, oy + 9, 2, 3, TUNIC_D);
  } else {
    rect(hero, ox + 3, oy + 9 + (step > 0 ? -1 : 0), 1, 3, SKIN);
    rect(hero, ox + 12, oy + 9 + (step < 0 ? -1 : 0), 1, 3, SKIN);
  }
  // head
  rect(hero, ox + 4, oy + 2, 8, 6, SKIN);
  rect(hero, ox + 4, oy + 1, 8, 2, HAIR);
  if (dir === "up") rect(hero, ox + 4, oy + 1, 8, 6, HAIR);
  if (dir === "down") {
    pset(hero, ox + 6, oy + 5, OUT);
    pset(hero, ox + 9, oy + 5, OUT);
    rect(hero, ox + 4, oy + 3, 1, 2, HAIR);
    rect(hero, ox + 11, oy + 3, 1, 2, HAIR);
  }
  if (dir === "left") {
    rect(hero, ox + 8, oy + 2, 4, 4, HAIR);
    pset(hero, ox + 5, oy + 5, OUT);
  }
  if (dir === "right") {
    rect(hero, ox + 4, oy + 2, 4, 4, HAIR);
    pset(hero, ox + 10, oy + 5, OUT);
  }
}
["down", "left", "right", "up"].forEach((dir, row) => {
  for (let f = 0; f < 4; f++) drawHero(f * T, row * T, dir, f);
});

// ---------- write ----------
function save(path, img) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img));
  console.log("wrote", path);
}
save("public/assets/tilesets/overworld.png", ts);
save("public/assets/sprites/hero.png", hero);
