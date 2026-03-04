import { MinecraftToolkitError } from "../errors.js";

const DEFAULT_CLASS_PREFIX = "mc";
const DEFAULT_ANIMATION_NAME = "mc-obfuscated-flicker";
const DEFAULT_OBFUSCATED_SPEED_MS = 110;

const COLOR_CODES = freezeNested({
  0: { name: "black", classSuffix: "black", hex: "#000000" },
  1: { name: "dark_blue", classSuffix: "dark-blue", hex: "#0000aa" },
  2: { name: "dark_green", classSuffix: "dark-green", hex: "#00aa00" },
  3: { name: "dark_aqua", classSuffix: "dark-aqua", hex: "#00aaaa" },
  4: { name: "dark_red", classSuffix: "dark-red", hex: "#aa0000" },
  5: { name: "dark_purple", classSuffix: "dark-purple", hex: "#aa00aa" },
  6: { name: "gold", classSuffix: "gold", hex: "#ffaa00" },
  7: { name: "gray", classSuffix: "gray", hex: "#aaaaaa" },
  8: { name: "dark_gray", classSuffix: "dark-gray", hex: "#555555" },
  9: { name: "blue", classSuffix: "blue", hex: "#5555ff" },
  a: { name: "green", classSuffix: "green", hex: "#55ff55" },
  b: { name: "aqua", classSuffix: "aqua", hex: "#55ffff" },
  c: { name: "red", classSuffix: "red", hex: "#ff5555" },
  d: { name: "light_purple", classSuffix: "light-purple", hex: "#ff55ff" },
  e: { name: "yellow", classSuffix: "yellow", hex: "#ffff55" },
  f: { name: "white", classSuffix: "white", hex: "#ffffff" },
  g: { name: "minecoin_gold", classSuffix: "minecoin-gold", hex: "#e1c158" },
  h: { name: "material_quartz", classSuffix: "material-quartz", hex: "#ece6d8" },
  i: { name: "material_iron", classSuffix: "material-iron", hex: "#cacaca" },
  j: { name: "material_netherite", classSuffix: "material-netherite", hex: "#4b4946" },
  n: { name: "material_redstone", classSuffix: "material-redstone", hex: "#b02e26" },
  p: { name: "material_prismarine", classSuffix: "material-prismarine", hex: "#1ba19b" },
  q: { name: "material_obsidian", classSuffix: "material-obsidian", hex: "#0b0b0b" },
  s: { name: "material_crimson", classSuffix: "material-crimson", hex: "#a02c44" },
  t: { name: "material_gold", classSuffix: "material-gold", hex: "#d8af48" },
  u: { name: "material_emerald", classSuffix: "material-emerald", hex: "#30c67c" },
  v: { name: "material_diamond", classSuffix: "material-diamond", hex: "#5be5e5" },
});

const FORMAT_CODES = freezeNested({
  k: { name: "obfuscated", classSuffix: "obfuscated" },
  l: { name: "bold", classSuffix: "bold" },
  m: { name: "strikethrough", classSuffix: "strikethrough" },
  n: { name: "underline", classSuffix: "underline" },
  o: { name: "italic", classSuffix: "italic" },
});

const VALID_CODE_CHARS = new Set([...Object.keys(COLOR_CODES), ...Object.keys(FORMAT_CODES), "r"]);
const COLOR_KEYS = new Set(Object.keys(COLOR_CODES));

export function toHTML(input, options) {
  const value = coerceInput(input);
  if (!value) {
    return "";
  }

  const resolved = resolveRenderOptions(options);
  const segments = tokenize(value);

  return segments.map((segment) => renderSegment(segment, resolved)).join("");
}

export function stripCodes(input) {
  const value = coerceInput(input);
  return value.replaceAll(/(?:§|&)[0-9a-fghijklmnpqrstuvr]/gi, "");
}

export function hasCodes(input) {
  const value = coerceInput(input);
  for (let i = 0; i < value.length - 1; i += 1) {
    const candidate = value[i];
    if (
      (candidate === "§" || candidate === "&") &&
      VALID_CODE_CHARS.has(value[i + 1]?.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export function generateCSS(options) {
  const resolved = resolveRenderOptions(options);
  const lines = [];

  lines.push(
    `.${resolved.classPrefix}-segment { color: inherit; font-weight: inherit; font-style: inherit; }`,
  );

  Object.values(COLOR_CODES).forEach((entry) => {
    lines.push(`.${resolved.classPrefix}-color-${entry.classSuffix} { color: ${entry.hex}; }`);
  });

  lines.push(`.${resolved.classPrefix}-format-bold { font-weight: 700; }`);
  lines.push(`.${resolved.classPrefix}-format-italic { font-style: italic; }`);
  lines.push(`.${resolved.classPrefix}-format-underline { text-decoration: underline; }`);
  lines.push(`.${resolved.classPrefix}-format-strikethrough { text-decoration: line-through; }`);
  lines.push(
    `.${resolved.classPrefix}-format-underline.${resolved.classPrefix}-format-strikethrough { text-decoration: underline line-through; }`,
  );
  lines.push(
    `.${resolved.classPrefix}-format-obfuscated { animation: ${resolved.animationName} ${resolved.obfuscatedSpeedMs}ms steps(10, end) infinite; display: inline-block; }`,
  );

  lines.push(
    `@keyframes ${resolved.animationName} { 0%, 100% { opacity: 0.8; } 50% { opacity: 0.2; } }`,
  );

  return lines.join("\n");
}

export function convertPrefix(input, direction = "toSection") {
  const value = coerceInput(input);

  const normalized = direction?.toLowerCase();
  if (normalized !== "tosection" && normalized !== "toampersand") {
    throw new MinecraftToolkitError("direction must be either 'toSection' or 'toAmpersand'");
  }

  if (normalized === "toampersand") {
    return value.replaceAll("§", "&");
  }
  return value.replaceAll("&", "§");
}

export function getMaps() {
  return {
    colors: COLOR_CODES,
    formats: FORMAT_CODES,
  };
}

function tokenize(input) {
  const segments = [];
  let color = null;
  const formats = new Set();
  let buffer = "";

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1]?.toLowerCase();

    if ((char === "§" || char === "&") && next && VALID_CODE_CHARS.has(next)) {
      if (buffer) {
        segments.push({ text: buffer, color, formats: Array.from(formats) });
        buffer = "";
      }

      if (COLOR_KEYS.has(next)) {
        color = next;
        formats.clear();
      } else if (next === "r") {
        color = null;
        formats.clear();
      } else {
        formats.add(next);
      }
      i += 1;
      continue;
    }

    buffer += char;
  }

  if (buffer) {
    segments.push({ text: buffer, color, formats: Array.from(formats) });
  }

  return segments;
}

function renderSegment(segment, options) {
  const safeText = options.escapeHtml ? escapeHtml(segment.text) : segment.text;
  const needsStyling = segment.color || segment.formats.length;
  if (!needsStyling) {
    return safeText;
  }

  if (options.mode === "class") {
    const classNames = buildClassNames(segment, options);
    return classNames.length
      ? `<span class="${classNames.join(" ")}">${safeText}</span>`
      : safeText;
  }

  const inlineStyle = buildInlineStyle(segment, options);
  return inlineStyle ? `<span style="${inlineStyle}">${safeText}</span>` : safeText;
}

function buildClassNames(segment, options) {
  const classes = [`${options.classPrefix}-segment`];

  if (segment.color) {
    const colorMeta = COLOR_CODES[segment.color];
    classes.push(`${options.classPrefix}-color-${colorMeta.classSuffix}`);
  }

  segment.formats.forEach((code) => {
    const meta = FORMAT_CODES[code];
    if (meta) {
      classes.push(`${options.classPrefix}-format-${meta.classSuffix}`);
    }
  });

  return classes;
}

function buildInlineStyle(segment, options) {
  const declarations = [];
  const textDecorations = new Set();

  if (segment.color) {
    declarations.push(`color: ${COLOR_CODES[segment.color].hex}`);
  }

  segment.formats.forEach((code) => {
    switch (code) {
      case "l":
        declarations.push("font-weight: 700");
        break;
      case "o":
        declarations.push("font-style: italic");
        break;
      case "m":
        textDecorations.add("line-through");
        break;
      case "n":
        textDecorations.add("underline");
        break;
      case "k":
        declarations.push(
          `animation: ${options.animationName} ${options.obfuscatedSpeedMs}ms steps(10, end) infinite`,
        );
        declarations.push("display: inline-block");
        break;
      default:
        break;
    }
  });

  if (textDecorations.size) {
    declarations.push(`text-decoration: ${Array.from(textDecorations).join(" ")}`);
  }

  return declarations.join("; ");
}

function escapeHtml(value) {
  return value
    .replaceAll(/&/g, "&amp;")
    .replaceAll(/</g, "&lt;")
    .replaceAll(/>/g, "&gt;")
    .replaceAll(/"/g, "&quot;")
    .replaceAll(/'/g, "&#39;");
}

function coerceInput(input) {
  if (input == null) {
    return "";
  }
  return typeof input === "string" ? input : String(input);
}

function resolveRenderOptions(options = {}) {
  const mode = options.mode === "class" ? "class" : "inline";
  const classPrefix = options.classPrefix ?? DEFAULT_CLASS_PREFIX;
  const animationName = options.animationName ?? DEFAULT_ANIMATION_NAME;
  const obfuscatedSpeedMs = Number.isFinite(options.obfuscatedSpeedMs)
    ? Number(options.obfuscatedSpeedMs)
    : DEFAULT_OBFUSCATED_SPEED_MS;

  return {
    mode,
    classPrefix,
    animationName,
    obfuscatedSpeedMs,
    escapeHtml: options.escapeHtml !== false,
  };
}

function freezeNested(map) {
  Object.values(map).forEach((entry) => Object.freeze(entry));
  return Object.freeze(map);
}
