import { PNG } from "pngjs";
import { MinecraftToolkitError } from "../errors.js";
import { decodePngFromUrl } from "../utils/png.js";
import { resolvePlayer } from "./resolve.js";
import { getSkinModel, getSkinURL } from "./textures.js";

const HEAD_BASE = { x: 8, y: 8, w: 8, h: 8 };
const HEAD_OVERLAY = { x: 40, y: 8, w: 8, h: 8 };
const BODY_BASE = { x: 20, y: 20, w: 8, h: 12 };
const BODY_OVERLAY = { x: 20, y: 36, w: 8, h: 12 };

const DEFAULT_HEAD_SIZE = 128;
const DEFAULT_BUST_SIZE = 128;

function armRegion(slim, overlay, side) {
  const width = slim ? 3 : 4;
  if (side === "right") {
    return { x: 44, y: overlay ? 36 : 20, w: width, h: 12 };
  }
  return { x: overlay ? 52 : 36, y: 52, w: width, h: 12 };
}

export async function renderPlayerHead(input, options = {}) {
  const { size = DEFAULT_HEAD_SIZE, overlay = true } = options;
  const { skin } = await loadSkin(input, options);

  const canvas = createCanvas(HEAD_BASE.w, HEAD_BASE.h);
  blit(canvas, skin, HEAD_BASE, 0, 0);
  if (overlay) {
    blit(canvas, skin, HEAD_OVERLAY, 0, 0, { alphaBlend: true });
  }

  return toResult(scaleNearest(canvas, size));
}

export async function renderPlayerBust(input, options = {}) {
  const { size = DEFAULT_BUST_SIZE, overlay = true } = options;
  const { skin, model } = await loadSkin(input, options);

  const slim = model === "slim";
  const hasLeftLimbData = skin.height >= 64;

  const rightArm = armRegion(slim, false, "right");
  const leftArm = hasLeftLimbData ? armRegion(slim, false, "left") : rightArm;
  const rightArmOverlay = armRegion(slim, true, "right");
  const leftArmOverlay = hasLeftLimbData ? armRegion(slim, true, "left") : rightArmOverlay;

  const width = rightArm.w + BODY_BASE.w + leftArm.w;
  const height = HEAD_BASE.h + BODY_BASE.h;
  const canvas = createCanvas(width, height);

  const headX = Math.floor((width - HEAD_BASE.w) / 2);
  blit(canvas, skin, HEAD_BASE, headX, 0);
  if (overlay) {
    blit(canvas, skin, HEAD_OVERLAY, headX, 0, { alphaBlend: true });
  }

  blit(canvas, skin, rightArm, 0, HEAD_BASE.h);
  if (overlay) {
    blit(canvas, skin, rightArmOverlay, 0, HEAD_BASE.h, { alphaBlend: true });
  }

  const bodyX = rightArm.w;
  blit(canvas, skin, BODY_BASE, bodyX, HEAD_BASE.h);
  if (overlay) {
    blit(canvas, skin, BODY_OVERLAY, bodyX, HEAD_BASE.h, { alphaBlend: true });
  }

  const leftX = bodyX + BODY_BASE.w;
  const mirrorLeft = !hasLeftLimbData;
  blit(canvas, skin, leftArm, leftX, HEAD_BASE.h, { mirror: mirrorLeft });
  if (overlay) {
    blit(canvas, skin, leftArmOverlay, leftX, HEAD_BASE.h, {
      mirror: mirrorLeft,
      alphaBlend: true,
    });
  }

  return toResult(scaleNearest(canvas, size));
}

async function loadSkin(input, options) {
  let skinUrl;
  let model = options.model ?? null;

  if (typeof input === "string" && /^https?:\/\//i.test(input)) {
    skinUrl = input;
  } else {
    const player = await resolvePlayer(input);
    skinUrl = getSkinURL(player);
    model = model ?? getSkinModel(player);
    if (!skinUrl) {
      throw new MinecraftToolkitError("Player has no skin texture", { statusCode: 404 });
    }
  }

  const skin = await decodePngFromUrl(skinUrl);
  return { skin, model: model ?? "default" };
}

function createCanvas(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function getPixel(image, x, y) {
  const idx = (y * image.width + x) * 4;
  return [image.data[idx], image.data[idx + 1], image.data[idx + 2], image.data[idx + 3]];
}

function setPixel(image, x, y, r, g, b, a) {
  const idx = (y * image.width + x) * 4;
  image.data[idx] = r;
  image.data[idx + 1] = g;
  image.data[idx + 2] = b;
  image.data[idx + 3] = a;
}

function blit(dest, src, region, destX, destY, { mirror = false, alphaBlend = false } = {}) {
  for (let row = 0; row < region.h; row += 1) {
    for (let col = 0; col < region.w; col += 1) {
      const srcX = region.x + col;
      const srcY = region.y + row;
      if (srcX < 0 || srcX >= src.width || srcY < 0 || srcY >= src.height) {
        continue;
      }

      const [r, g, b, a] = getPixel(src, srcX, srcY);
      if (a === 0) {
        continue;
      }

      const dx = destX + (mirror ? region.w - 1 - col : col);
      const dy = destY + row;
      if (dx < 0 || dx >= dest.width || dy < 0 || dy >= dest.height) {
        continue;
      }

      if (alphaBlend && a < 255) {
        const [dr, dg, db, da] = getPixel(dest, dx, dy);
        const alpha = a / 255;
        const outA = a + da * (1 - alpha);
        const nr = Math.round(r * alpha + dr * (1 - alpha));
        const ng = Math.round(g * alpha + dg * (1 - alpha));
        const nb = Math.round(b * alpha + db * (1 - alpha));
        setPixel(dest, dx, dy, nr, ng, nb, Math.round(outA));
      } else {
        setPixel(dest, dx, dy, r, g, b, a);
      }
    }
  }
}

function scaleNearest(image, targetSize) {
  const scale = Math.max(1, Math.floor(targetSize / Math.max(image.width, image.height)));
  const width = image.width * scale;
  const height = image.height * scale;
  const out = createCanvas(width, height);

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.floor(y / scale);
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.floor(x / scale);
      const [r, g, b, a] = getPixel(image, srcX, srcY);
      setPixel(out, x, y, r, g, b, a);
    }
  }

  return out;
}

function toResult(image) {
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  const buffer = PNG.sync.write(png);
  const base64 = buffer.toString("base64");

  return {
    width: image.width,
    height: image.height,
    buffer,
    base64,
    dataUri: `data:image/png;base64,${base64}`,
  };
}
