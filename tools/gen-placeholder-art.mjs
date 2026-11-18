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
// Art is designed on a 16-unit grid and rendered at S pixels per unit (S = 2 -> 32x32 tiles).
// Shapes like discs are drawn at full resolution so they come out smooth, `fine()` places
// single real pixels for texture, and `outline()` adds a dark edge around sprites.
const S = 2;
const image = (w, h) => ({ w: w * S, h: h * S, px: Buffer.alloc(w * S * h * S * 4) });
function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
/** Sets one real pixel. */
function fine(img, x, y, color) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return;
  const [r, g, b, a] = typeof color === "string" ? hex(color) : color;
  const i = (y * img.w + x) * 4;
  img.px[i] = r;
  img.px[i + 1] = g;
  img.px[i + 2] = b;
  img.px[i + 3] = a;
}
/** Sets one design unit (S x S real pixels). */
function pset(img, x, y, color) {
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) fine(img, x * S + i, y * S + j, color);
}
function rect(img, x, y, w, h, color) {
  for (let j = 0; j < h * S; j++) for (let i = 0; i < w * S; i++) fine(img, x * S + i, y * S + j, color);
}
/** Filled circle centred on design unit (cx, cy), drawn at full resolution. */
function disc(img, cx, cy, r, color) {
  const rx = (cx + 0.5) * S, ry = (cy + 0.5) * S, rr = (r + 0.5) * S;
  for (let y = Math.floor(ry - rr); y <= ry + rr; y++)
    for (let x = Math.floor(rx - rr); x <= rx + rr; x++)
      if ((x + 0.5 - rx) ** 2 + (y + 0.5 - ry) ** 2 <= rr * rr) fine(img, x, y, color);
}
let seed = 1234;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
/** Random single real pixels over a 16x16-unit tile (texture). */
function speckle(img, ox, oy, colors, count) {
  for (let i = 0; i < count * S; i++)
    fine(img, ox * S + Math.floor(rand() * 16 * S), oy * S + Math.floor(rand() * 16 * S), colors[i % colors.length]);
}
/**
 * Draws a 1px dark outline around opaque shapes, inside the box (x, y, w, h) in design
 * units (so neighbouring tiles in a sheet don't bleed into each other).
 */
function outline(img, x, y, w, h, color = "#1a1420") {
  const x0 = x * S, y0 = y * S, x1 = (x + w) * S, y1 = (y + h) * S;
  const alpha = (px, py) => (px < x0 || py < y0 || px >= x1 || py >= y1 ? 0 : img.px[(py * img.w + px) * 4 + 3]);
  const add = [];
  for (let py = y0; py < y1; py++)
    for (let px = x0; px < x1; px++) {
      if (alpha(px, py) !== 0) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => alpha(px + dx, py + dy) === 255)) add.push([px, py]);
    }
  for (const [px, py] of add) fine(img, px, py, color);
}

// ---------- tileset ----------
// Keep this list in sync with public/assets/tilesets/overworld.tsj (solid flags).
const T = 16; // tile size in design units (x S = 32px)
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
    for (const [wx, wy] of [[2, 3], [9, 6], [4, 11], [11, 13]]) {
      rect(ts, x + wx, y + wy, 4, 0.5, "#7fb6ef");
      fine(ts, (x + wx + 4) * S, (y + wy) * S, "#b8dcff");
    }
    speckle(ts, x, y, ["#3a7cd0"], 10);
  },
  tree(x, y) {
    rect(ts, x + 6, y + 10, 4, 6, "#6b4423");
    disc(ts, x + 8, y + 7, 6, "#2d6b2a");
    disc(ts, x + 7, y + 6, 4, "#3e8a37");
    // leaf texture
    for (let i = 0; i < 60; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 5.5;
      fine(ts, (x + 8.5 + Math.cos(a) * r) * S, (y + 7.5 + Math.sin(a) * r) * S, i % 3 ? "#25592a" : "#5aa84f");
    }
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
// Outline the objects that sit on top of other tiles.
for (const name of ["tree", "sign", "rock", "table"]) {
  const i = tiles.indexOf(name);
  outline(ts, (i % COLS) * T, Math.floor(i / COLS) * T, T, T);
}

// ---------- character sprite sheets ----------
// 4 columns (walk frames: stand, step, stand, step) x 4 rows (down, left, right, up).
const OUT = "#1c1a24";
const PALETTES = {
  aren: { skin: "#f1c79a", hair: "#5a3a1e", tunic: "#3a6fd0", tunicD: "#28509c", boot: "#3b2a1a" },
  lyra: { skin: "#f6d3b3", hair: "#e0b44a", tunic: "#8a46b8", tunicD: "#62308a", boot: "#4a2a5a", hat: "#4a2a7a" },
  bram: { skin: "#d9a57a", hair: "#2a2a2a", tunic: "#8a909c", tunicD: "#5e6470", boot: "#3a3a44", helmet: "#a9b0bc" },
  // townsfolk
  merchant: { skin: "#e8b98c", hair: "#7a4a20", tunic: "#2f8a5a", tunicD: "#1f6a42", boot: "#3b2a1a" },
  innkeeper: { skin: "#f1c79a", hair: "#b8b8c0", tunic: "#b0483a", tunicD: "#7a3026", boot: "#3b2a1a" },
};
function drawChar(img, ox, oy, dir, frame, P) {
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  rect(img, ox + 4, oy + 15, 8, 1, [0, 0, 0, 70]);
  rect(img, ox + 5, oy + 12 - (step > 0 ? 1 : 0), 2, 3, P.boot);
  rect(img, ox + 9, oy + 12 - (step < 0 ? 1 : 0), 2, 3, P.boot);
  rect(img, ox + 4, oy + 8, 8, 5, P.tunic);
  rect(img, ox + 4, oy + 12, 8, 1, P.tunicD);
  if (dir === "left" || dir === "right") {
    rect(img, ox + 7 + step, oy + 9, 2, 3, P.tunicD);
  } else {
    rect(img, ox + 3, oy + 9 + (step > 0 ? -1 : 0), 1, 3, P.skin);
    rect(img, ox + 12, oy + 9 + (step < 0 ? -1 : 0), 1, 3, P.skin);
  }
  rect(img, ox + 4, oy + 2, 8, 6, P.skin);
  rect(img, ox + 4, oy + 1, 8, 2, P.hair);
  if (dir === "up") rect(img, ox + 4, oy + 1, 8, 6, P.hair);
  if (dir === "down") {
    pset(img, ox + 6, oy + 5, OUT);
    pset(img, ox + 9, oy + 5, OUT);
    rect(img, ox + 4, oy + 3, 1, 2, P.hair);
    rect(img, ox + 11, oy + 3, 1, 2, P.hair);
  }
  if (dir === "left") {
    rect(img, ox + 8, oy + 2, 4, 4, P.hair);
    pset(img, ox + 5, oy + 5, OUT);
  }
  if (dir === "right") {
    rect(img, ox + 4, oy + 2, 4, 4, P.hair);
    pset(img, ox + 10, oy + 5, OUT);
  }
  if (P.hat) {
    // pointed wizard hat
    rect(img, ox + 3, oy + 2, 10, 1, P.hat);
    rect(img, ox + 5, oy + 0, 6, 2, P.hat);
  }
  // finer details: belt, eye shine, hair highlight
  rect(img, ox + 4, oy + 11, 8, 0.5, P.tunicD);
  if (dir === "down") {
    fine(img, (ox + 6) * S, (oy + 5) * S, "#ffffff");
    fine(img, (ox + 9) * S, (oy + 5) * S, "#ffffff");
  }
  if (dir === "left") fine(img, (ox + 5) * S, (oy + 5) * S, "#ffffff");
  if (dir === "right") fine(img, (ox + 10) * S + 1, (oy + 5) * S, "#ffffff");
  if (P.helmet) {
    rect(img, ox + 4, oy + 1, 8, 2, P.helmet);
    if (dir !== "up") rect(img, ox + 4, oy + 3, 1, 2, P.helmet), rect(img, ox + 11, oy + 3, 1, 2, P.helmet);
    else rect(img, ox + 4, oy + 1, 8, 5, P.helmet);
  }
}
const sheets = {};
for (const [name, P] of Object.entries(PALETTES)) {
  const img = image(4 * T, 4 * T);
  ["down", "left", "right", "up"].forEach((dir, row) => {
    for (let f = 0; f < 4; f++) {
      drawChar(img, f * T, row * T, dir, f, P);
      outline(img, f * T, row * T, T, T);
    }
  });
  sheets[name] = img;
}

// ---------- enemies (32x32, single frame; the game animates them) ----------
const E = 32;
function enemySlime() {
  const img = image(E, E);
  rect(img, 6, 29, 20, 2, [0, 0, 0, 70]);
  for (let y = 0; y < 18; y++) {
    const half = Math.round(Math.sqrt(1 - ((17 - y) / 18) ** 2) * 13);
    rect(img, 16 - half, 12 + y, half * 2, 1, y < 4 ? "#7ee06a" : "#4fbf45");
  }
  rect(img, 6, 28, 20, 2, "#2f8a2c");
  rect(img, 10, 16, 3, 3, "#c8f7b8");
  rect(img, 11, 19, 3, 3, OUT); rect(img, 19, 19, 3, 3, OUT);
  pset(img, 11, 19, "#fff"); pset(img, 19, 19, "#fff");
  rect(img, 14, 24, 4, 1, "#2f8a2c");
  return img;
}
function enemyBat() {
  const img = image(E, E);
  rect(img, 10, 29, 12, 2, [0, 0, 0, 50]);
  // wings
  for (let i = 0; i < 10; i++) {
    rect(img, 2 + i, 8 + Math.abs(5 - i), 1, 8 - Math.abs(5 - i) / 2 | 0, "#5a3a8a");
    rect(img, 29 - i, 8 + Math.abs(5 - i), 1, 8 - Math.abs(5 - i) / 2 | 0, "#5a3a8a");
  }
  disc(img, 16, 13, 6, "#3c2660");
  rect(img, 11, 5, 2, 4, "#3c2660"); rect(img, 19, 5, 2, 4, "#3c2660");
  rect(img, 13, 11, 2, 2, "#ff5050"); rect(img, 17, 11, 2, 2, "#ff5050");
  pset(img, 14, 16, "#fff"); pset(img, 17, 16, "#fff");
  return img;
}
function enemyGoblin() {
  const img = image(E, E);
  rect(img, 7, 29, 18, 2, [0, 0, 0, 70]);
  rect(img, 11, 24, 4, 5, "#4a3420"); rect(img, 17, 24, 4, 5, "#4a3420");
  rect(img, 9, 15, 14, 10, "#7a5a32");
  rect(img, 9, 20, 14, 2, "#5a4022");
  rect(img, 6, 16, 3, 7, "#5aa04a"); rect(img, 23, 16, 3, 7, "#5aa04a");
  // club
  rect(img, 25, 8, 3, 14, "#8a5a2e"); rect(img, 24, 5, 5, 5, "#6b4423");
  rect(img, 10, 5, 12, 10, "#6ab85a");
  rect(img, 6, 7, 4, 3, "#6ab85a"); rect(img, 22, 7, 4, 3, "#6ab85a");
  rect(img, 12, 9, 2, 2, "#ffe14a"); rect(img, 18, 9, 2, 2, "#ffe14a");
  pset(img, 13, 10, OUT); pset(img, 19, 10, OUT);
  rect(img, 13, 13, 6, 1, "#2f5a28");
  pset(img, 14, 14, "#fff"); pset(img, 17, 14, "#fff");
  return img;
}

// ---------- write ----------
function save(path, img) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encodePng(img));
  console.log("wrote", path);
}
save("public/assets/tilesets/overworld.png", ts);
for (const [name, img] of Object.entries(sheets)) save(`public/assets/sprites/${name}.png`, img);
for (const [name, make] of [["slime", enemySlime], ["bat", enemyBat], ["goblin", enemyGoblin]]) {
  const img = make();
  outline(img, 0, 0, E, E);
  save(`public/assets/enemies/${name}.png`, img);
}
