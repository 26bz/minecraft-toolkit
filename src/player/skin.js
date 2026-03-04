import { PNG } from "pngjs";
import { MinecraftToolkitError } from "../errors.js";
import { fetchPlayerProfile } from "./profile/index.js";

const HEAD_REGION = { x: 8, y: 8, width: 8, height: 8 };

export async function fetchSkinMetadata(username, options = {}) {
  const profile = await fetchPlayerProfile(username);
  const skinUrl = profile.skin?.url ?? null;
  let dominantColor = null;

  if (skinUrl && options.dominantColor !== false) {
    dominantColor = await computeSkinDominantColor(skinUrl, options.sampleRegion);
  }

  return {
    id: profile.id,
    name: profile.name,
    skin: profile.skin,
    cape: profile.cape,
    hasCape: Boolean(profile.cape),
    dominantColor,
  };
}

export async function computeSkinDominantColor(url, region = HEAD_REGION) {
  const png = await fetchPng(url);
  const { width, height, data } = png;
  const { x, y, width: regionWidth, height: regionHeight } = clampRegion(region, width, height);

  let r = 0;
  let g = 0;
  let b = 0;
  let samples = 0;

  for (let row = y; row < y + regionHeight; row += 1) {
    for (let col = x; col < x + regionWidth; col += 1) {
      const idx = (row * width + col) * 4;
      const alpha = data[idx + 3] / 255;
      if (alpha === 0) {
        continue;
      }
      r += data[idx] * alpha;
      g += data[idx + 1] * alpha;
      b += data[idx + 2] * alpha;
      samples += 1;
    }
  }

  if (samples === 0) {
    return null;
  }

  const avgR = Math.round(r / samples);
  const avgG = Math.round(g / samples);
  const avgB = Math.round(b / samples);
  return rgbToHex(avgR, avgG, avgB);
}

async function fetchPng(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new MinecraftToolkitError(`Unable to load skin texture: ${url}`, {
      statusCode: response.status,
    });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new MinecraftToolkitError("Unable to decode PNG skin texture", {
      statusCode: 500,
      cause: error,
    });
  }
}

function clampRegion(region, width, height) {
  const x = Math.max(0, Math.min(width - 1, region.x ?? HEAD_REGION.x));
  const y = Math.max(0, Math.min(height - 1, region.y ?? HEAD_REGION.y));
  const regionWidth = Math.min(region.width ?? HEAD_REGION.width, width - x);
  const regionHeight = Math.min(region.height ?? HEAD_REGION.height, height - y);
  return { x, y, width: regionWidth, height: regionHeight };
}

function rgbToHex(r, g, b) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value) {
  return value.toString(16).padStart(2, "0");
}
