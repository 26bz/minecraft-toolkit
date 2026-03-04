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
const jebProfileJson = { id: "853c80ef3c3749fdaa49938b674adae6", name: "jeb_" };
const jebSessionJson = {
  id: "853c80ef3c3749fdaa49938b674adae6",
  name: "jeb_",
  properties: [{ name: "textures", value: encodedTextures }],
};

function mockFetchSequence(responses) {
  let callIndex = 0;
  globalThis.fetch = vi.fn(async () => {
    const entry = responses[callIndex++];
    if (!entry) {
      throw new Error("Unexpected fetch call");
    }
    const status = entry.status ?? 200;
    const headers = entry.headers;
    if (entry.text !== undefined) {
      return new Response(entry.text, {
        status,
        headers,
      });
    }
    if (entry.body !== undefined) {
      return new Response(entry.body, {
        status,
        headers,
      });
    }
    const body = [204, 205, 304].includes(status) ? null : JSON.stringify(entry.json ?? null);
    const responseHeaders =
      body === null ? headers : { "content-type": "application/json", ...headers };
    return new Response(body, {
      status,
      headers: responseHeaders,
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

  it("serves name history route", async () => {
    mockFetchSequence([{ json: [{ name: "Notch", changedToAt: null }] }]);

    const { app } = createPlayerApp();
    const response = await app.request(`/player/${profileJson.id}/names`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual([{ name: "Notch", changedAt: null }]);
  });

  it("serves exists route", async () => {
    mockFetchSequence([{ json: profileJson }]);

    const { app } = createPlayerApp();
    const response = await app.request("/player/26bz/exists");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ username: "26bz", exists: true });
  });

  it("serves batch route", async () => {
    mockFetchSequence([
      { json: profileJson },
      { json: sessionJson },
      { json: jebProfileJson },
      { json: jebSessionJson },
    ]);

    const { app } = createPlayerApp();
    const response = await app.request("/players/batch", {
      method: "POST",
      body: JSON.stringify({ usernames: ["26bz", "jeb_"] }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(2);
    expect(body[0].profile.name).toBe("26bz");
    expect(body[1].profile.name).toBe("jeb_");
  });

  it("requires auth for account routes", async () => {
    const { app } = createPlayerApp();
    const response = await app.request("/account/namechange");
    expect(response.status).toBe(401);
  });

  it("serves namechange route when authorized", async () => {
    mockFetchSequence([{ json: { nameChangeAllowed: false } }]);

    const { app } = createPlayerApp();
    const response = await app.request("/account/namechange", {
      headers: { authorization: "Bearer token" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ nameChangeAllowed: false });
  });

  it("serves name availability route", async () => {
    mockFetchSequence([{ json: { status: "AVAILABLE" } }]);

    const { app } = createPlayerApp();
    const response = await app.request("/account/name/newname/availability", {
      headers: { authorization: "Bearer token" },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("AVAILABLE");
  });

  it("validates gift code", async () => {
    mockFetchSequence([{ status: 204 }]);

    const { app } = createPlayerApp();
    const response = await app.request("/account/gift-code/validate", {
      method: "POST",
      headers: {
        authorization: "Bearer token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: "ABC123" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ code: "ABC123", valid: true });
  });

  it("returns blocked servers list", async () => {
    mockFetchSequence([{ text: "server1\nserver2" }]);

    const { app } = createPlayerApp();
    const response = await app.request("/account/blocked-servers");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(["server1", "server2"]);
  });
});
