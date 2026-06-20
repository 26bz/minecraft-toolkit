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
} from "../index.js";
import { fetchJavaServerStatus, fetchBedrockServerStatus, fetchServerStatus } from "../index.js";
import { ResponseCache, withCache } from "../src/utils/cache/index.js";
import { createCache } from "../src/utils/cache/index.js";
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
