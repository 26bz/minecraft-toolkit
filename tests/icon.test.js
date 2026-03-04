import { describe, it, expect, vi } from "vitest";
import { fetchServerIcon } from "../src/server/icon.js";

vi.mock("../src/server/status.js", () => ({
  fetchJavaServerStatus: vi.fn(async () => ({
    host: "example.org",
    port: 25565,
    favicon: "data:image/png;base64,YWJj",
    raw: {},
  })),
}));

describe("fetchServerIcon", () => {
  it("returns decoded favicon metadata", async () => {
    const result = await fetchServerIcon("example.org");
    expect(result.host).toBe("example.org");
    expect(result.dataUri).toBe("data:image/png;base64,YWJj");
    expect(result.base64).toBe("YWJj");
    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.byteLength).toBe(3);
  });
});
