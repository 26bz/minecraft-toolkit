import { describe, it, expect, vi, afterEach } from "vitest";
import { createServer } from "node:net";
import { createSocket } from "node:dgram";
import {
  MinecraftToolkitError,
  fetchPlayerProfile,
  fetchPlayerSkin,
  fetchPlayerUUID,
  fetchUsernameByUUID,
  fetchNameHistory,
  fetchSkinMetadata,
  fetchPlayers,
  fetchNameChangeInfo,
  checkNameAvailability,
  validateGiftCode,
  fetchBlockedServers,
  fetchPlayerSummary,
  playerExists,
  hasSkinChanged,
  resolvePlayer,
  toHTML,
  stripCodes,
  generateCSS,
  hasCodes,
  convertPrefix,
  getMaps,
  legacyToComponent,
  componentToLegacy,
  componentToMiniMessage,
  miniMessageToComponent,
  legacyToMiniMessage,
  miniMessageToLegacy,
} from "../index.js";
import {
  fetchJavaServerStatus,
  fetchBedrockServerStatus,
  fetchServerStatus,
  discoverServer,
  watchServerStatus,
  createRconClient,
  sendRconCommand,
  renderPlayerHead,
  renderPlayerBust,
  withRetry,
  fetchJson,
  fetchRequest,
  ResponseCache,
  createCache,
  withCache,
} from "../index.js";
import {
  uuidWithDashes,
  uuidWithoutDashes,
  isValidUsername,
  isUUID,
  normalizeUUID,
} from "../src/player/identity/index.js";
import {
  getSkinURL,
  getCapeURL,
  getSkinModel,
  extractTextureHash,
} from "../src/player/textures.js";
import { resolveTimeout, makeError } from "../src/server/shared.js";
import { normalizeAddress, normalizeUsername, validatePort } from "../src/utils/validation.js";
import { PNG } from "pngjs";
import { RAKNET_MAGIC } from "../src/constants.js";

function mockFetchSequence(responses) {
  let callIndex = 0;
  globalThis.fetch = vi.fn(async () => {
    const entry = responses[callIndex++];
    if (!entry) {
      throw new Error("Unexpected fetch call");
    }
    if (entry.body) {
      return new Response(entry.body, { status: entry.status ?? 200, headers: entry.headers });
    }
    return new Response(JSON.stringify(entry.json ?? null), {
      status: entry.status ?? 200,
      headers: { "content-type": "application/json", ...entry.headers },
    });
  });
}

function restoreFetch() {
  if (vi.isMockFunction(globalThis.fetch)) {
    globalThis.fetch.mockClear();
    delete globalThis.fetch;
  }
}

function encodeVarInt(value) {
  const bytes = [];
  let current = value >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current !== 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (current !== 0);
  return Buffer.from(bytes);
}

function writeString(value) {
  const data = Buffer.from(value, "utf8");
  return Buffer.concat([encodeVarInt(data.length), data]);
}

function createJavaPacket(packetId, payload) {
  const packet = Buffer.concat([encodeVarInt(packetId), payload]);
  return Buffer.concat([encodeVarInt(packet.length), packet]);
}

function buildJavaStatusResponse() {
  const response = JSON.stringify({
    version: { name: "1.20.4", protocol: 765 },
    players: { max: 20, online: 1 },
    description: { text: "Toolkit Test Server" },
    favicon: "data:image/png;base64,YWJj",
  });
  return createJavaPacket(0, writeString(response));
}

function buildJavaPongPacket() {
  return createJavaPacket(1, Buffer.alloc(8));
}

function buildBedrockStatusMessage(port) {
  const payload = [
    "MCPE",
    "Toolkit Bedrock Server",
    "589",
    "1.20.4",
    "1",
    "10",
    "1234567890",
    "world",
    "Survival",
    String(port),
    String(port),
  ].join(";");

  const data = Buffer.from(payload, "utf8");
  const message = Buffer.alloc(35 + data.length);
  message.writeUInt8(0x1c, 0);
  RAKNET_MAGIC.copy(message, 17);
  message.writeUInt16BE(data.length, 33);
  data.copy(message, 35);
  return message;
}

function encodeRconPacket(id, type, body) {
  const bodyBuffer = Buffer.from(body, "utf8");
  const payloadLength = 4 + 4 + bodyBuffer.length + 2;
  const packet = Buffer.alloc(4 + payloadLength);
  packet.writeInt32LE(payloadLength, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuffer.copy(packet, 12);
  return packet;
}

function readRconPacket(buffer) {
  if (buffer.length < 4) {
    return null;
  }
  const length = buffer.readInt32LE(0);
  if (buffer.length < 4 + length) {
    return null;
  }
  const id = buffer.readInt32LE(4);
  const type = buffer.readInt32LE(8);
  const body = buffer.toString("utf8", 12, 4 + length - 2);
  return { id, type, body, consumed: 4 + length };
}

function createMockRconServer(password) {
  return createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let packet = readRconPacket(buffer);
      while (packet) {
        buffer = buffer.subarray(packet.consumed);
        if (packet.type === 3) {
          socket.write(
            packet.body === password
              ? encodeRconPacket(packet.id, 2, "")
              : encodeRconPacket(-1, 2, ""),
          );
        } else if (packet.type === 2) {
          socket.write(encodeRconPacket(packet.id, 0, `echo:${packet.body}`));
        }
        packet = readRconPacket(buffer);
      }
    });
  });
}

async function listenTcp(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve(server.address()));
  });
}

async function listenUdp(socket) {
  return new Promise((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, () => resolve(socket.address()));
  });
}

async function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function fillSkinRegion(png, x0, y0, w, h, [r, g, b, a]) {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const idx = (y * png.width + x) * 4;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
}

function buildTestSkinPng({ height = 64 } = {}) {
  const png = new PNG({ width: 64, height });
  fillSkinRegion(png, 8, 8, 8, 8, [255, 0, 0, 255]); // head base: red
  fillSkinRegion(png, 40, 8, 8, 8, [0, 0, 255, 128]); // head overlay: translucent blue
  fillSkinRegion(png, 20, 20, 8, 12, [0, 255, 0, 255]); // body base: green
  fillSkinRegion(png, 44, 20, 4, 12, [255, 255, 0, 255]); // right arm base: yellow
  if (height >= 64) {
    fillSkinRegion(png, 36, 52, 4, 12, [0, 255, 255, 255]); // left arm base: cyan
  }
  return PNG.sync.write(png);
}

const encodedTextures = Buffer.from(
  JSON.stringify({ textures: { SKIN: { url: "https://textures.minecraft.net/skin/26bz" } } }),
).toString("base64");

const profileJson = { id: "069a79f444e94726a5befca90e38aaf5", name: "26bz" };
const sessionJson = {
  id: "069a79f444e94726a5befca90e38aaf5",
  name: "26bz",
  properties: [{ name: "textures", value: encodedTextures }],
};

describe("player helper API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreFetch();
  });

  it("fetches profile & skin", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: sessionJson },
      { json: profileJson },
      { json: sessionJson },
    ]);

    const profile = await fetchPlayerProfile("26bz");
    expect(profile.id).toBe(profileJson.id);
    expect(profile.skin.url).toContain("textures.minecraft.net/skin/26bz");

    const skin = await fetchPlayerSkin("26bz");
    expect(skin.skin.url).toContain("textures.minecraft.net/skin/26bz");
  });

  it("fetches UUID and reverse username lookup", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: sessionJson },
      { json: sessionJson },
      { json: sessionJson },
      { json: sessionJson },
      { json: profileJson },
      { json: sessionJson },
    ]);

    const { id } = await fetchPlayerUUID("26bz");
    expect(id).toBe(profileJson.id);

    const reverse = await fetchUsernameByUUID(profileJson.id);
    expect(reverse).toEqual({ id: profileJson.id, name: "26bz" });

    const resolved = await resolvePlayer(profileJson.id);
    expect(resolved.id).toContain("-");
    expect(resolved.name).toBe("26bz");
  });

  it("fetchNameHistory throws 410 (Mojang API removed)", async () => {
    const err = await fetchNameHistory("26bzuuid").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(410);
  });

  it("fetches skin metadata with dominant color", async () => {
    const png = new PNG({ width: 8, height: 8 });
    png.data.fill(0);
    for (let i = 0; i < png.data.length; i += 4) {
      png.data[i] = 255; // R
      png.data[i + 3] = 255; // A
    }
    const pngBuffer = PNG.sync.write(png);

    mockFetchSequence([
      { json: profileJson },
      { json: sessionJson },
      { body: pngBuffer, headers: { "content-type": "image/png" } },
    ]);

    const metadata = await fetchSkinMetadata("26bz");
    expect(metadata.dominantColor).toBe("#ff0000");
    expect(metadata.hasCape).toBe(false);
  });

  it("performs batch fetch with error capture", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: sessionJson },
      { status: 404, json: { error: "not found" } },
    ]);

    const results = await fetchPlayers(["26bz", "ghost"], { delayMs: 0 });
    expect(results).toHaveLength(2);
    expect(results[0].profile.name).toBe("26bz");
    expect(results[1].error).toBeInstanceOf(Error);
  });

  it("checks existence and summary", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: profileJson },
      { json: sessionJson },
      { status: 404, json: { error: "not found" } },
    ]);

    expect(await playerExists("26bz")).toBe(true);
    const summary = await fetchPlayerSummary("26bz");
    expect(summary.skinUrl ?? "").toContain("textures.minecraft.net");
    expect(await playerExists("ghost")).toBe(false);
  });

  it("aborts batch player fetches", async () => {
    const controller = new AbortController();
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const batch = fetchPlayers(["26bz", "ghost"], { delayMs: 50, signal: controller.signal });
    controller.abort();

    const err = await batch.catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(499);
  });

  it("detects skin changes", () => {
    const profile = { skin: { url: "https://textures.minecraft.net/texture/abc" } };
    const changed = { skin: { url: "https://textures.minecraft.net/texture/def" } };
    expect(hasSkinChanged(profile, changed)).toBe(true);
    expect(
      hasSkinChanged(profile, { skin: { url: "https://textures.minecraft.net/texture/abc" } }),
    ).toBe(false);
  });
});

describe("account helpers", () => {
  const accessToken = "dummy-token";

  afterEach(() => {
    vi.restoreAllMocks();
    if (vi.isMockFunction(globalThis.fetch)) {
      globalThis.fetch.mockClear();
      delete globalThis.fetch;
    }
  });

  it("fetches name change info", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ changedAt: "2024-01-01T00:00:00Z", nameChangeAllowed: true }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const info = await fetchNameChangeInfo(accessToken);
    expect(info.nameChangeAllowed).toBe(true);
  });

  it("checks name availability", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ status: "AVAILABLE" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const result = await checkNameAvailability("newname", accessToken);
    expect(result.status).toBe("AVAILABLE");
  });

  it("validates gift codes", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await validateGiftCode("ABC123", accessToken)).toBe(true);

    globalThis.fetch.mockImplementationOnce(async () => new Response(null, { status: 404 }));
    expect(await validateGiftCode("XYZ", accessToken)).toBe(false);
  });

  it("fetches blocked servers list", async () => {
    globalThis.fetch = vi.fn(async () => new Response("hash1\nhash2\n", { status: 200 }));
    const blocked = await fetchBlockedServers();
    expect(blocked).toEqual(["hash1", "hash2"]);
  });

  it("wraps fetch failures in MinecraftToolkitError", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });

    const err = await fetchBlockedServers().catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(502);
  });
});

describe("uuid helpers", () => {
  it("formats UUID with and without dashes", () => {
    const dashed = "069a79f4-44e9-4726-a5be-fca90e38aaf5";
    const compact = "069a79f444e94726a5befca90e38aaf5";
    expect(uuidWithoutDashes(dashed)).toBe(compact);
    expect(uuidWithDashes(compact)).toBe(dashed);
    expect(isUUID(dashed)).toBe(true);
    expect(normalizeUUID(dashed)).toBe(compact.toLowerCase());
    expect(isValidUsername("26bz")).toBe(true);
  });

  it("rejects invalid UUID input", () => {
    expect(isUUID(123)).toBe(false);
    expect(isUUID("not-a-uuid")).toBe(false);
    expect(() => normalizeUUID("not-a-uuid")).toThrow(MinecraftToolkitError);
  });

  it("normalizes dashed UUIDs in reverse lookup", async () => {
    mockFetchSequence([{ json: sessionJson }]);

    const result = await fetchUsernameByUUID("069a79f4-44e9-4726-a5be-fca90e38aaf5");
    expect(result.id).toBe(profileJson.id);
  });
});

describe("texture helpers", () => {
  it("extracts skin details", () => {
    const profile = {
      skin: { url: "https://textures.minecraft.net/texture/abc", metadata: { model: "slim" } },
      cape: { url: "https://textures.minecraft.net/texture/cape" },
    };
    expect(getSkinURL(profile)).toContain("abc");
    expect(getCapeURL(profile)).toContain("cape");
    expect(getSkinModel(profile)).toBe("slim");
    expect(extractTextureHash(profile.skin.url)).toBe("abc");
  });
});

describe("formatting helpers", () => {
  it("renders inline HTML with proper resets", () => {
    const rendered = toHTML("§aHello §lWorld§r!", { mode: "inline" });
    expect(rendered).toContain("color: #55ff55");
    expect(rendered).toContain("font-weight: 700");
    expect(rendered.endsWith("!</span>!")).toBe(false);
    expect(rendered.endsWith("!"));
  });

  it("escapes html and rejects invalid prefix direction", () => {
    expect(toHTML("<script>", { escapeHtml: true })).toContain("&lt;script&gt;");
    expect(toHTML("<script>", { escapeHtml: false })).toContain("<script>");
    expect(() => convertPrefix("&a", "invalid")).toThrow(MinecraftToolkitError);
  });

  it("handles empty input", () => {
    expect(toHTML("", { mode: "inline" })).toBe("");
    expect(stripCodes("")).toBe("");
    expect(hasCodes("")).toBe(false);
  });

  it("renders class-based HTML and generates CSS", () => {
    const rendered = toHTML("&bHi &kobfuscated", { mode: "class", classPrefix: "demo" });
    expect(rendered).toContain('class="demo-segment demo-color-aqua"');
    expect(rendered).toContain("demo-format-obfuscated");

    const css = generateCSS({ classPrefix: "demo", animationName: "demo-anim" });
    expect(css).toContain(".demo-color-aqua");
    expect(css).toContain("@keyframes demo-anim");
  });

  it("strips and detects formatting codes", () => {
    const input = "§cError §lBold";
    expect(stripCodes(input)).toBe("Error Bold");
    expect(hasCodes(input)).toBe(true);
    expect(hasCodes("Plain text")).toBe(false);
  });

  it("hasCodes handles edge cases", () => {
    expect(hasCodes("")).toBe(false);
    expect(hasCodes(null)).toBe(false);
    expect(hasCodes(undefined)).toBe(false);
    expect(hasCodes("§")).toBe(false);
    expect(hasCodes("&")).toBe(false);
    expect(hasCodes("§r")).toBe(true);
    expect(hasCodes("&R")).toBe(true);
    expect(hasCodes("§z")).toBe(false);
    expect(hasCodes("text§amore")).toBe(true);
  });

  it("converts prefixes and exposes maps", () => {
    const converted = convertPrefix("§aHi", "toAmpersand");
    expect(converted).toBe("&aHi");
    expect(convertPrefix(converted, "toSection")).toBe("§aHi");

    const maps = getMaps();
    expect(maps.colors.a.hex).toBe("#55ff55");
    expect(maps.formats.l.classSuffix).toBe("bold");
  });
});

describe("text components", () => {
  it("converts legacy codes to JSON components", () => {
    const components = legacyToComponent("§aHello §lWorld");
    expect(components).toEqual([
      { text: "Hello ", color: "green" },
      { text: "World", color: "green", bold: true },
    ]);
  });

  it("round-trips components back to legacy codes", () => {
    const legacy = componentToLegacy([
      { text: "Hello ", color: "green" },
      { text: "World", color: "green", bold: true },
    ]);
    expect(legacy).toBe("§aHello §a§lWorld");
  });

  it("flattens nested extra components", () => {
    const legacy = componentToLegacy({
      text: "",
      extra: [{ text: "Hi", color: "red", italic: true }],
    });
    expect(legacy).toBe("§c§oHi");
  });

  it("converts components to and from MiniMessage tags", () => {
    const mini = componentToMiniMessage([{ text: "Hi", color: "red", bold: true }]);
    expect(mini).toBe("<red><bold>Hi</bold></red>");

    const components = miniMessageToComponent("<red><bold>Hi</bold></red> there");
    expect(components).toEqual([{ text: "Hi", color: "red", bold: true }, { text: " there" }]);
  });

  it("supports hex colors in MiniMessage", () => {
    const components = miniMessageToComponent("<#ff00aa>Hi</#ff00aa>");
    expect(components).toEqual([{ text: "Hi", color: "#ff00aa" }]);
  });

  it("chains legacy <-> MiniMessage conversions", () => {
    expect(legacyToMiniMessage("§cHi")).toBe("<red>Hi</red>");
    expect(miniMessageToLegacy("<red>Hi</red>")).toBe("§cHi");
  });
});

describe("resolvePlayer error contract", () => {
  it("throws MinecraftToolkitError for empty string", async () => {
    await expect(resolvePlayer("")).rejects.toBeInstanceOf(MinecraftToolkitError);
  });

  it("throws MinecraftToolkitError for non-string input", async () => {
    await expect(resolvePlayer(null)).rejects.toBeInstanceOf(MinecraftToolkitError);
    await expect(resolvePlayer(42)).rejects.toBeInstanceOf(MinecraftToolkitError);
  });

  it("throws with statusCode 400", async () => {
    const err = await resolvePlayer("  ").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(400);
  });

  it("resolves usernames through the player profile path", async () => {
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const resolved = await resolvePlayer("26bz");
    expect(resolved.name).toBe("26bz");
    expect(resolved.id).toContain("-");
  });
});

describe("network parsing", () => {
  it("parses bracketed IPv6 host with port", async () => {
    const { resolveAddress } = await import("../src/utils/network.js");
    expect(resolveAddress("[::1]:25565", undefined, 25565)).toEqual({
      host: "[::1]",
      port: 25565,
    });
  });

  it("prefers an explicit override port and passes the host through verbatim", async () => {
    const { resolveAddress } = await import("../src/utils/network.js");
    expect(resolveAddress("play.example.net", 19132, 25565)).toEqual({
      host: "play.example.net",
      port: 19132,
    });
  });

  it("falls back to the fallback port for a bare host", async () => {
    const { resolveAddress } = await import("../src/utils/network.js");
    expect(resolveAddress("play.example.net", undefined, 25565)).toEqual({
      host: "play.example.net",
      port: 25565,
    });
  });

  it("falls back to the fallback port for an unbracketed multi-colon host", async () => {
    const { resolveAddress } = await import("../src/utils/network.js");
    expect(resolveAddress("::1", undefined, 25565)).toEqual({
      host: "::1",
      port: 25565,
    });
  });

  it("falls back to the fallback port when the embedded port is empty", async () => {
    const { resolveAddress } = await import("../src/utils/network.js");
    expect(resolveAddress("play.example.net:", undefined, 25565)).toEqual({
      host: "play.example.net:",
      port: 25565,
    });
  });
});

describe("java status SRV skip heuristic", () => {
  afterEach(() => {
    vi.doUnmock("node:dns/promises");
    vi.resetModules();
  });

  it("does not query SRV records for a bracketed IPv6 host with an explicit port", async () => {
    const resolveSrv = vi.fn();
    vi.doMock("node:dns/promises", () => ({ resolveSrv }));
    vi.resetModules();
    const { fetchJavaServerStatus: freshFetchJavaServerStatus } =
      await import("../src/server/java/status.js");

    await freshFetchJavaServerStatus("[::1]:1", { timeoutMs: 50 }).catch(() => {});

    expect(resolveSrv).not.toHaveBeenCalled();
  });

  it("queries SRV records when no port is provided", async () => {
    const resolveSrv = vi.fn().mockRejectedValue(new Error("no SRV record"));
    vi.doMock("node:dns/promises", () => ({ resolveSrv }));
    vi.resetModules();
    const { fetchJavaServerStatus: freshFetchJavaServerStatus } =
      await import("../src/server/java/status.js");

    await freshFetchJavaServerStatus("play.example.net", { timeoutMs: 50 }).catch(() => {});

    expect(resolveSrv).toHaveBeenCalledWith("_minecraft._tcp.play.example.net");
  });
});

describe("server status transports", () => {
  it("parses Java status from a local server", async () => {
    const server = createServer((socket) => {
      let seenRequest = false;
      socket.on("data", (chunk) => {
        if (!seenRequest) {
          seenRequest = true;
          socket.write(buildJavaStatusResponse());
          return;
        }

        if (chunk.length > 0) {
          socket.write(buildJavaPongPacket());
          socket.end();
        }
      });
    });

    const address = await listenTcp(server);
    const status = await fetchJavaServerStatus("127.0.0.1", {
      port: address.port,
      timeoutMs: 2000,
    });
    server.close();

    expect(status.edition).toBe("java");
    expect(status.online).toBe(true);
    expect(status.motd).toBe("Toolkit Test Server");
    expect(status.version?.name).toBe("1.20.4");
    expect(status.players?.online).toBe(1);
  });

  it("parses Bedrock status from a local server", async () => {
    const socket = createSocket("udp4");
    socket.on("message", (_message, rinfo) => {
      socket.send(buildBedrockStatusMessage(rinfo.port), rinfo.port, rinfo.address);
    });

    const address = await listenUdp(socket);
    const status = await fetchBedrockServerStatus("127.0.0.1", {
      port: address.port,
      timeoutMs: 2000,
    });
    socket.close();

    expect(status.edition).toBe("bedrock");
    expect(status.online).toBe(true);
    expect(status.motd).toBe("Toolkit Bedrock Server");
    expect(status.version.name).toBe("1.20.4");
    expect(status.players.online).toBe(1);
  });

  it("dispatches server status by edition", async () => {
    const server = createServer((socket) => {
      let seenRequest = false;
      socket.on("data", (chunk) => {
        if (!seenRequest) {
          seenRequest = true;
          socket.write(buildJavaStatusResponse());
          return;
        }
        if (chunk.length > 0) {
          socket.write(buildJavaPongPacket());
          socket.end();
        }
      });
    });

    const address = await listenTcp(server);
    const status = await fetchServerStatus("127.0.0.1", { edition: "auto", port: address.port });
    server.close();

    expect(status.edition).toBe("java");
  });

  it("rejects invalid server edition", async () => {
    const err = await fetchServerStatus("127.0.0.1", { edition: "bogus" }).catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(400);
  });
});

describe("discoverServer", () => {
  it("returns the Java status when only the Java probe succeeds", async () => {
    const server = createServer((socket) => {
      let seenRequest = false;
      socket.on("data", (chunk) => {
        if (!seenRequest) {
          seenRequest = true;
          socket.write(buildJavaStatusResponse());
          return;
        }
        if (chunk.length > 0) {
          socket.write(buildJavaPongPacket());
          socket.end();
        }
      });
    });

    const address = await listenTcp(server);
    const status = await discoverServer("127.0.0.1", {
      javaPort: address.port,
      bedrockPort: 1,
      timeoutMs: 500,
    });
    server.close();

    expect(status.edition).toBe("java");
    expect(status.motd).toBe("Toolkit Test Server");
  });

  it("returns the Bedrock status when only the Bedrock probe succeeds", async () => {
    const socket = createSocket("udp4");
    socket.on("message", (_message, rinfo) => {
      socket.send(buildBedrockStatusMessage(rinfo.port), rinfo.port, rinfo.address);
    });

    const address = await listenUdp(socket);
    const status = await discoverServer("127.0.0.1", {
      javaPort: 1,
      bedrockPort: address.port,
      timeoutMs: 500,
    });
    socket.close();

    expect(status.edition).toBe("bedrock");
    expect(status.motd).toBe("Toolkit Bedrock Server");
  });

  it("throws when neither probe succeeds", async () => {
    const err = await discoverServer("127.0.0.1", {
      javaPort: 1,
      bedrockPort: 1,
      timeoutMs: 300,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MinecraftToolkitError);
  });
});

describe("rcon client", () => {
  it("authenticates and executes multiple commands", async () => {
    const server = createMockRconServer("secret");
    const address = await listenTcp(server);

    const client = await createRconClient({
      host: "127.0.0.1",
      port: address.port,
      password: "secret",
      timeoutMs: 2000,
    });

    expect(await client.execute("list")).toBe("echo:list");
    expect(await client.execute("say hi")).toBe("echo:say hi");

    client.close();
    server.close();
  });

  it("rejects with 401 on bad password", async () => {
    const server = createMockRconServer("secret");
    const address = await listenTcp(server);

    const err = await createRconClient({
      host: "127.0.0.1",
      port: address.port,
      password: "wrong",
      timeoutMs: 2000,
    }).catch((e) => e);

    server.close();
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(401);
  });

  it("sendRconCommand connects, runs one command, and closes", async () => {
    const server = createMockRconServer("secret");
    const address = await listenTcp(server);

    const response = await sendRconCommand({
      host: "127.0.0.1",
      port: address.port,
      password: "secret",
      command: "list",
      timeoutMs: 2000,
    });

    server.close();
    expect(response).toBe("echo:list");
  });

  it("rejects executing after the client is closed", async () => {
    const server = createMockRconServer("secret");
    const address = await listenTcp(server);

    const client = await createRconClient({
      host: "127.0.0.1",
      port: address.port,
      password: "secret",
      timeoutMs: 2000,
    });
    client.close();
    server.close();

    const err = await client.execute("list").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
  });

  it("rejects when the host is unreachable", async () => {
    const err = await createRconClient({
      host: "127.0.0.1",
      port: 1,
      password: "secret",
      timeoutMs: 500,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MinecraftToolkitError);
  });
});

describe("watchServerStatus", () => {
  it("polls status, fires onChange only on meaningful change, and stops cleanly", async () => {
    let onlineCount = 1;
    const server = createServer((socket) => {
      let seenRequest = false;
      socket.on("data", (chunk) => {
        if (!seenRequest) {
          seenRequest = true;
          const response = JSON.stringify({
            version: { name: "1.20.4", protocol: 765 },
            players: { max: 20, online: onlineCount },
            description: { text: "Toolkit Test Server" },
          });
          socket.write(createJavaPacket(0, writeString(response)));
          return;
        }
        if (chunk.length > 0) {
          socket.write(buildJavaPongPacket());
          socket.end();
        }
      });
    });

    const address = await listenTcp(server);
    const updates = [];
    const changes = [];

    const handle = watchServerStatus("127.0.0.1", {
      port: address.port,
      timeoutMs: 2000,
      intervalMs: 20,
      onUpdate: (status) => updates.push(status),
      onChange: (status) => changes.push(status),
    });

    await waitFor(() => updates.length >= 2);
    onlineCount = 5;
    await waitFor(() => changes.length >= 2);

    handle.stop();
    const changeCountAtStop = changes.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    server.close();

    expect(changes.length).toBe(changeCountAtStop);
    expect(changes[0].players.online).toBe(1);
    expect(changes[1].players.online).toBe(5);
  });

  it("reports failures via onError instead of throwing", async () => {
    const errors = [];
    const handle = watchServerStatus("127.0.0.1", {
      port: 1,
      timeoutMs: 200,
      intervalMs: 20,
      onError: (error) => errors.push(error),
    });

    await waitFor(() => errors.length >= 1);
    handle.stop();

    expect(errors[0]).toBeInstanceOf(MinecraftToolkitError);
  });
});

describe("withRetry", () => {
  it("retries rate-limited calls and eventually succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new MinecraftToolkitError("rate limited", { statusCode: 429, retryAfter: 0 });
        }
        return "ok";
      },
      { retries: 5, minDelayMs: 1 },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("gives up after exhausting the retry budget", async () => {
    let attempts = 0;
    const err = await withRetry(
      async () => {
        attempts += 1;
        throw new MinecraftToolkitError("rate limited", { statusCode: 429, retryAfter: 0 });
      },
      { retries: 2, minDelayMs: 1 },
    ).catch((e) => e);

    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(429);
    expect(attempts).toBe(3);
  });

  it("does not retry non-429 errors", async () => {
    let attempts = 0;
    const err = await withRetry(async () => {
      attempts += 1;
      throw new MinecraftToolkitError("not found", { statusCode: 404 });
    }, {}).catch((e) => e);

    expect(err.statusCode).toBe(404);
    expect(attempts).toBe(1);
  });

  it("invokes onRetry with attempt and delay info", async () => {
    const retryInfo = [];
    let attempts = 0;
    await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 2) {
          throw new MinecraftToolkitError("rate limited", { statusCode: 429, retryAfter: 0 });
        }
        return "ok";
      },
      { retries: 3, minDelayMs: 1, onRetry: (info) => retryInfo.push(info) },
    );

    expect(retryInfo).toHaveLength(1);
    expect(retryInfo[0].attempt).toBe(1);
  });
});

describe("public HTTP utilities", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("fetchRequest performs a request with default headers", async () => {
    mockFetchSequence([{ json: { ok: true } }]);
    const response = await fetchRequest("https://example.com/test");
    expect(response.status).toBe(200);
  });

  it("fetchJson throws MinecraftToolkitError on 404", async () => {
    mockFetchSequence([{ status: 404 }]);
    const err = await fetchJson("https://example.com/missing", {
      notFoundMessage: "missing",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(404);
  });
});

describe("skin rendering", () => {
  afterEach(() => {
    restoreFetch();
  });

  it("renders a player head with the hat overlay alpha-blended", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(buildTestSkinPng(), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const head = await renderPlayerHead("https://example.com/skin.png", { size: 8 });
    expect(head.width).toBe(8);
    expect(head.height).toBe(8);
    expect(head.buffer).toBeInstanceOf(Buffer);
    expect(head.dataUri).toMatch(/^data:image\/png;base64,/);

    const decoded = PNG.sync.read(head.buffer);
    expect([decoded.data[0], decoded.data[1], decoded.data[2], decoded.data[3]]).toEqual([
      127, 0, 128, 255,
    ]);
  });

  it("renders a player head without the overlay when disabled", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(buildTestSkinPng(), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const head = await renderPlayerHead("https://example.com/skin.png", {
      size: 8,
      overlay: false,
    });
    const decoded = PNG.sync.read(head.buffer);
    expect([decoded.data[0], decoded.data[1], decoded.data[2], decoded.data[3]]).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("renders a bust with the body flanked by the arms", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(buildTestSkinPng(), { status: 200, headers: { "content-type": "image/png" } }),
    );

    const bust = await renderPlayerBust("https://example.com/skin.png", { size: 16 });
    expect(bust.width).toBe(16);
    expect(bust.height).toBe(20);

    const decoded = PNG.sync.read(bust.buffer);
    const pixelAt = (x, y) => {
      const idx = (y * bust.width + x) * 4;
      return [
        decoded.data[idx],
        decoded.data[idx + 1],
        decoded.data[idx + 2],
        decoded.data[idx + 3],
      ];
    };

    expect(pixelAt(0, 8)).toEqual([255, 255, 0, 255]); // right arm: yellow
    expect(pixelAt(4, 8)).toEqual([0, 255, 0, 255]); // body: green
    expect(pixelAt(12, 8)).toEqual([0, 255, 255, 255]); // left arm: cyan
  });

  it("mirrors the right arm for legacy 64x32 skins with no left-limb data", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(buildTestSkinPng({ height: 32 }), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
    );

    const bust = await renderPlayerBust("https://example.com/skin.png", { size: 16 });
    const decoded = PNG.sync.read(bust.buffer);
    const idx = (8 * bust.width + 12) * 4;
    expect([
      decoded.data[idx],
      decoded.data[idx + 1],
      decoded.data[idx + 2],
      decoded.data[idx + 3],
    ]).toEqual([255, 255, 0, 255]); // mirrored right arm: yellow
  });

  it("throws when the resolved player has no skin texture", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: { id: profileJson.id, name: "26bz", properties: [] } },
    ]);

    const err = await renderPlayerHead("26bz").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(404);
  });
});

describe("cache and timeout helpers", () => {
  it("creates caches from options and respects null cache", async () => {
    expect(createCache({ cache: false })).toBeNull();
    expect(createCache({ ttlSeconds: 1 })).toBeTruthy();
    expect(createCache({ cache: { ttlSeconds: 1, maxSize: 2 } })).toBeTruthy();

    const resolver = vi.fn(async () => "value");
    const result = await withCache(null, "key", resolver);
    expect(result).toBe("value");
    expect(resolver).toHaveBeenCalledOnce();
  });

  it("resolves timeout defaults and builds errors", () => {
    expect(resolveTimeout(2500)).toBe(2500);
    expect(resolveTimeout(-1)).toBeGreaterThan(0);
    expect(resolveTimeout(Number.POSITIVE_INFINITY)).toBeGreaterThan(0);

    const error = makeError("boom", new Error("cause"));
    expect(error).toBeInstanceOf(MinecraftToolkitError);
    expect(error.cause).toBeInstanceOf(Error);
  });
});

describe("validation helpers", () => {
  it("normalizes and validates addresses, usernames, and ports", () => {
    expect(normalizeAddress(" example.org ")).toBe("example.org");
    expect(normalizeUsername(" 26bz ")).toBe("26bz");
    expect(validatePort("25565")).toBe(25565);
    expect(() => validatePort(0)).toThrow(MinecraftToolkitError);
    expect(() => normalizeAddress(123)).toThrow(MinecraftToolkitError);
    expect(() => normalizeUsername(null)).toThrow(MinecraftToolkitError);
  });
});

describe("ResponseCache", () => {
  it("stores and retrieves values within TTL", () => {
    const cache = new ResponseCache(5000);
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");
  });

  it("returns undefined for expired entries", async () => {
    const cache = new ResponseCache(1);
    cache.set("key", "value");
    await new Promise((r) => setTimeout(r, 10));
    expect(cache.get("key")).toBeUndefined();
  });

  it("enforces maxSize with FIFO eviction", () => {
    const cache = new ResponseCache(30000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(3);

    cache.set("d", 4);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(4);
  });

  it("updating an existing key does not evict other entries", () => {
    const cache = new ResponseCache(30000, 3);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("b", 99);
    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(99);
  });

  it("withCache skips resolver on hit", async () => {
    const cache = new ResponseCache(5000);
    const resolver = vi.fn(async () => "fresh");
    cache.set("k", "cached");
    const result = await withCache(cache, "k", resolver);
    expect(result).toBe("cached");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("withCache calls resolver on miss and stores result", async () => {
    const cache = new ResponseCache(5000);
    const resolver = vi.fn(async () => "fresh");
    const result = await withCache(cache, "k", resolver);
    expect(result).toBe("fresh");
    expect(resolver).toHaveBeenCalledOnce();
    expect(cache.get("k")).toBe("fresh");
  });
});

describe("fetchNameHistory deprecation", () => {
  it("always throws with statusCode 410", async () => {
    const err = await fetchNameHistory("any-uuid").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(410);
    expect(err.message).toMatch(/removed/i);
  });
});

describe("MinecraftToolkitError export", () => {
  it("is exported from the main index", () => {
    expect(MinecraftToolkitError).toBeDefined();
    const err = new MinecraftToolkitError("test", { statusCode: 400 });
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MinecraftToolkitError");
    expect(err.statusCode).toBe(400);
  });

  it("attaches retryAfter when provided", () => {
    const err = new MinecraftToolkitError("rate limited", { statusCode: 429, retryAfter: 60 });
    expect(err.retryAfter).toBe(60);
  });

  it("omits retryAfter when not provided", () => {
    const err = new MinecraftToolkitError("error");
    expect("retryAfter" in err).toBe(false);
  });
});

describe("rate limit handling", () => {
  afterEach(() => {
    if (vi.isMockFunction(globalThis.fetch)) {
      globalThis.fetch.mockClear();
      delete globalThis.fetch;
    }
  });

  it("fetchJson surfaces 429 with retryAfter from header", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { "retry-after": "120" },
        }),
    );

    const err = await fetchPlayerProfile("26bz").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(120);
  });

  it("fetchJson surfaces 429 with null retryAfter when header absent", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 429 }));

    const err = await fetchPlayerProfile("26bz").catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBeNull();
  });

  it("fetchPlayers propagates 429 instead of capturing it per-entry", async () => {
    const rateLimitEncodedTextures = Buffer.from(
      JSON.stringify({ textures: { SKIN: { url: "https://textures.minecraft.net/skin/a" } } }),
    ).toString("base64");

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "aaa", name: "first" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "aaa",
            name: "first",
            properties: [{ name: "textures", value: rateLimitEncodedTextures }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "60" } }));

    const err = await fetchPlayers(["first", "second", "third"], { delayMs: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(MinecraftToolkitError);
    expect(err.statusCode).toBe(429);
    expect(err.retryAfter).toBe(60);
  });
});
