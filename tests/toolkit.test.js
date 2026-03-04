import { describe, it, expect, vi, afterEach } from "vitest";
import {
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
import { PNG } from "pngjs";

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

  it("fetches name history", async () => {
    mockFetchSequence([
      { json: [{ name: "26bz" }, { name: "26bzNew", changedToAt: 1_700_000_000_000 }] },
    ]);

    const history = await fetchNameHistory("26bzuuid");
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ name: "26bzNew" });
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

  it("converts prefixes and exposes maps", () => {
    const converted = convertPrefix("§aHi", "toAmpersand");
    expect(converted).toBe("&aHi");
    expect(convertPrefix(converted, "toSection")).toBe("§aHi");

    const maps = getMaps();
    expect(maps.colors.a.hex).toBe("#55ff55");
    expect(maps.formats.l.classSuffix).toBe("bold");
  });
});
