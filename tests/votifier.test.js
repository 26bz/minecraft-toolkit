import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import {
  generateKeyPairSync,
  privateDecrypt,
  createHmac,
  constants as cryptoConstants,
} from "node:crypto";
import { sendVotifierVote } from "../index.js";

function listenAsync(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, () => resolve(server.address()));
  });
}

describe("votifier", () => {
  it("sends encrypted vote payloads after handshake", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "pkcs1", format: "pem" },
      privateKeyEncoding: { type: "pkcs1", format: "pem" },
    });

    let capturedPayload = null;

    const server = createServer((socket) => {
      socket.write("VOTIFIER 1.9\n");
      const chunks = [];
      socket.on("data", (chunk) => {
        chunks.push(chunk);
      });
      socket.on("end", () => {
        capturedPayload = Buffer.concat(chunks);
      });
    });

    const addressInfo = await listenAsync(server);

    const result = await sendVotifierVote({
      host: "127.0.0.1",
      port: addressInfo.port,
      publicKey,
      serviceName: "TestList",
      username: "26bz",
      address: "203.0.113.10",
    });

    server.close();

    expect(result).toEqual({ acknowledged: true, version: "1.9", protocol: "v1" });
    expect(capturedPayload).toBeInstanceOf(Buffer);
    expect(capturedPayload.length).toBeGreaterThan(0);

    const decrypted = privateDecrypt(
      {
        key: privateKey,
        padding: cryptoConstants.RSA_PKCS1_PADDING,
      },
      capturedPayload,
    )
      .toString("utf8")
      .trim()
      .split("\n");

    expect(decrypted[0]).toBe("VOTE");
    expect(decrypted[1]).toBe("TestList");
    expect(decrypted[2]).toBe("26bz");
    expect(decrypted[3]).toBe("203.0.113.10");
  });

  it("sends NuVotifier v2 payloads with token signature", async () => {
    const token = "super-secret-token";
    let capturedPacket;

    const server = createServer((socket) => {
      socket.write("VOTIFIER 2 abc123\n");
      socket.once("data", (packet) => {
        capturedPacket = packet;
        const magic = packet.readUInt16BE(0);
        expect(magic).toBe(0x733a);
        const length = packet.readUInt16BE(2);
        const payload = packet.subarray(4, 4 + length).toString("utf8");
        const message = JSON.parse(payload);
        const vote = JSON.parse(message.payload);
        expect(vote.serviceName).toBe("TestList");
        expect(vote.username).toBe("26bz");
        expect(vote.address).toBe("198.51.100.42");
        expect(vote.challenge).toBe("abc123");

        const expectedSignature = createHmac("sha256", token)
          .update(message.payload)
          .digest("base64");
        expect(message.signature).toBe(expectedSignature);

        socket.write(JSON.stringify({ status: "ok" }));
        socket.end();
      });
    });

    const addressInfo = await listenAsync(server);

    const result = await sendVotifierVote({
      host: "127.0.0.1",
      port: addressInfo.port,
      serviceName: "TestList",
      username: "26bz",
      address: "198.51.100.42",
      token,
      protocol: "v2",
    });

    server.close();

    expect(capturedPacket).toBeInstanceOf(Buffer);
    expect(result).toEqual({ acknowledged: true, version: "2", protocol: "v2" });
  });
});
