import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPlayerApp } from "../src/h3/routes.js";

const encodedTextures = Buffer.from(
  JSON.stringify({ textures: { SKIN: { url: "https://textures.minecraft.net/skin/26bz" } } }),
).toString("base64");

const profileJson = { id: "069a79f444e94726a5befca90e38aaf5", name: "26bz" };
const sessionJson = {
  id: "069a79f444e94726a5befca90e38aaf5",
  name: "26bz",
  properties: [{ name: "textures", value: encodedTextures }],
};

function mockFetchSequence(responses) {
  let callIndex = 0;
  globalThis.fetch = vi.fn(async () => {
    const entry = responses[callIndex++];
    if (!entry) {
      throw new Error("Unexpected fetch call");
    }
    return new Response(JSON.stringify(entry.json ?? null), {
      status: entry.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("h3 integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (vi.isMockFunction(globalThis.fetch)) {
      globalThis.fetch.mockClear();
      delete globalThis.fetch;
    }
  });

  it("serves player profile via createPlayerApp", async () => {
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const { app } = createPlayerApp();
    const response = await app.request("/player/26bz");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("26bz");
    expect(body.skin.url).toContain("textures.minecraft.net/skin/26bz");
  });

  it("resolves UUID route", async () => {
    mockFetchSequence([{ json: sessionJson }, { json: profileJson }, { json: sessionJson }]);

    const { app } = createPlayerApp();
    const response = await app.request(`/player/${profileJson.id}/resolve`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toContain("-");
    expect(body.name).toBe("26bz");
  });

  it("serves skin route", async () => {
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const { app } = createPlayerApp();
    const response = await app.request("/player/26bz/skin");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skin.url).toContain("textures.minecraft.net/skin/26bz");
  });

  it("serves summary route", async () => {
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const { app } = createPlayerApp();
    const response = await app.request("/player/26bz/summary");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skinUrl).toContain("textures.minecraft.net/skin/26bz");
    expect(body.capeUrl).toBeNull();
  });

  it("serves uuid route", async () => {
    mockFetchSequence([{ json: profileJson }, { json: sessionJson }]);

    const { app } = createPlayerApp();
    const response = await app.request("/player/26bz/uuid");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(profileJson.id);
  });
});
