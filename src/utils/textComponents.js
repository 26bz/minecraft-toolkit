import { tokenize, getMaps } from "./formatting.js";

const { colors: COLOR_CODES } = getMaps();

const CODE_BY_COLOR_NAME = new Map(
  Object.entries(COLOR_CODES).map(([code, meta]) => [meta.name, code]),
);

const FORMAT_FIELDS = ["bold", "italic", "underlined", "strikethrough", "obfuscated"];

const FORMAT_FIELD_BY_CODE = {
  l: "bold",
  o: "italic",
  n: "underlined",
  m: "strikethrough",
  k: "obfuscated",
};

const CODE_BY_FORMAT_FIELD = Object.fromEntries(
  Object.entries(FORMAT_FIELD_BY_CODE).map(([code, field]) => [field, code]),
);

const MINIMESSAGE_FORMAT_ALIASES = {
  bold: "bold",
  b: "bold",
  italic: "italic",
  i: "italic",
  em: "italic",
  underlined: "underlined",
  u: "underlined",
  strikethrough: "strikethrough",
  st: "strikethrough",
  obfuscated: "obfuscated",
  obf: "obfuscated",
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const MINIMESSAGE_TAG_RE = /<\/?([^<>]+)>/g;

export function legacyToComponent(input) {
  const segments = tokenize(coerceInput(input));
  if (segments.length === 0) {
    return [{ text: "" }];
  }

  return segments.map((segment) => {
    const component = { text: segment.text };
    if (segment.color) {
      component.color = COLOR_CODES[segment.color].name;
    }
    segment.formats.forEach((code) => {
      const field = FORMAT_FIELD_BY_CODE[code];
      if (field) {
        component[field] = true;
      }
    });
    return component;
  });
}

export function componentToLegacy(component) {
  return componentToSegments(component)
    .map((segment) => {
      let prefix = "";
      const code = segment.color ? CODE_BY_COLOR_NAME.get(segment.color) : null;
      if (code) {
        prefix += `§${code}`;
      }
      FORMAT_FIELDS.forEach((field) => {
        if (segment[field]) {
          prefix += `§${CODE_BY_FORMAT_FIELD[field]}`;
        }
      });
      return `${prefix}${segment.text}`;
    })
    .join("");
}

export function componentToMiniMessage(component) {
  return componentToSegments(component)
    .map((segment) => {
      const tags = [];
      if (segment.color) {
        tags.push(segment.color);
      }
      FORMAT_FIELDS.forEach((field) => {
        if (segment[field]) {
          tags.push(field);
        }
      });

      const open = tags.map((tag) => `<${tag}>`).join("");
      const close = tags
        .toReversed()
        .map((tag) => `</${tag}>`)
        .join("");
      return `${open}${segment.text}${close}`;
    })
    .join("");
}

export function miniMessageToComponent(input) {
  const value = coerceInput(input);
  const segments = [];
  const styleStack = [{ color: null, formats: new Set() }];

  let cursor = 0;
  MINIMESSAGE_TAG_RE.lastIndex = 0;
  let match = MINIMESSAGE_TAG_RE.exec(value);

  while (match) {
    const [full, rawName] = match;
    const textBefore = value.slice(cursor, match.index);
    if (textBefore) {
      pushMiniMessageSegment(segments, textBefore, styleStack[styleStack.length - 1]);
    }
    cursor = match.index + full.length;

    const isClosing = full.startsWith("</");
    const name = rawName.trim().toLowerCase();

    if (isClosing) {
      if (styleStack.length > 1) {
        styleStack.pop();
      }
    } else if (name === "reset") {
      styleStack.push({ color: null, formats: new Set() });
    } else {
      const current = styleStack[styleStack.length - 1];
      const next = { color: current.color, formats: new Set(current.formats) };

      if (MINIMESSAGE_FORMAT_ALIASES[name]) {
        next.formats.add(MINIMESSAGE_FORMAT_ALIASES[name]);
      } else {
        const color = resolveMiniMessageColor(name);
        if (color) {
          next.color = color;
        }
      }
      styleStack.push(next);
    }

    match = MINIMESSAGE_TAG_RE.exec(value);
  }

  const remaining = value.slice(cursor);
  if (remaining) {
    pushMiniMessageSegment(segments, remaining, styleStack[styleStack.length - 1]);
  }

  return segments.length ? segments : [{ text: "" }];
}

export function legacyToMiniMessage(input) {
  return componentToMiniMessage(legacyToComponent(input));
}

export function miniMessageToLegacy(input) {
  return componentToLegacy(miniMessageToComponent(input));
}

function componentToSegments(component, acc = []) {
  const list = Array.isArray(component) ? component : [component];

  for (const node of list) {
    if (node == null) {
      continue;
    }
    if (typeof node === "string") {
      acc.push({ text: node });
      continue;
    }

    const { text = "", extra, ...style } = node;
    if (text) {
      acc.push({ text, ...style });
    }
    if (extra) {
      componentToSegments(extra, acc);
    }
  }

  return acc;
}

function pushMiniMessageSegment(segments, text, style) {
  const segment = { text };
  if (style.color) {
    segment.color = style.color;
  }
  style.formats.forEach((field) => {
    segment[field] = true;
  });
  segments.push(segment);
}

function resolveMiniMessageColor(name) {
  if (HEX_COLOR_RE.test(name)) {
    return name.toLowerCase();
  }
  if (name.startsWith("color:") || name.startsWith("colour:")) {
    return resolveMiniMessageColor(name.slice(name.indexOf(":") + 1));
  }
  return CODE_BY_COLOR_NAME.has(name) ? name : null;
}

function coerceInput(input) {
  if (input == null) {
    return "";
  }
  return typeof input === "string" ? input : String(input);
}
