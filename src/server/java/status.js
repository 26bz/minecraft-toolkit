import { Socket } from "node:net";
import { resolveSrv } from "node:dns/promises";
import { DEFAULT_JAVA_PORT, DEFAULT_PROTOCOL_VERSION } from "../../constants.js";
import { MinecraftToolkitError } from "../../errors.js";
import { normalizeAddress } from "../../utils/validation.js";
import { resolveAddress } from "../../utils/network.js";
import { resolveTimeout, makeError } from "../shared.js";

const MAX_RECEIVE_BYTES = 1_048_576;
const SRV_TIMEOUT_MS = 2_000;

async function resolveSrvAddress(host, fallbackPort) {
  try {
    const records = await Promise.race([
      resolveSrv(`_minecraft._tcp.${host}`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("SRV timeout")), SRV_TIMEOUT_MS),
      ),
    ]);
    if (records.length > 0) {
      records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
      return { host: records[0].name, port: records[0].port };
    }
  } catch {
    // SRV not found, NXDOMAIN, or timed out — fall through to direct connection
  }
  return { host, port: fallbackPort };
}

export async function fetchJavaServerStatus(address, options = {}) {
  const normalized = normalizeAddress(address);

  // Skip SRV when the caller explicitly provided a port (via options or embedded in address string)
  const colonCount = (normalized.match(/:/g) ?? []).length;
  const portExplicit = options.port !== undefined || colonCount === 1;

  const { host: baseHost, port: basePort } = resolveAddress(
    normalized,
    options.port,
    DEFAULT_JAVA_PORT,
  );
  const { host, port } = portExplicit
    ? { host: baseHost, port: basePort }
    : await resolveSrvAddress(baseHost, basePort);

  const timeoutMs = resolveTimeout(options.timeoutMs);
  const protocolVersion = Number.isInteger(options.protocolVersion)
    ? options.protocolVersion
    : DEFAULT_PROTOCOL_VERSION;

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    let statusPayload = null;
    let settled = false;
    let pingStartedAt = 0;
    let pingFallbackTimer;

    const handshakePacket = buildHandshakePacket(host, port, protocolVersion);
    const statusRequestPacket = buildStatusRequestPacket();

    function cleanup() {
      clearTimeout(pingFallbackTimer);
      socket.removeAllListeners();
      socket.destroy();
    }

    function resolveOnce(value) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }

    function rejectOnce(error) {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(
        error instanceof MinecraftToolkitError
          ? error
          : makeError(`Unable to query ${host}:${port}`, error),
      );
    }

    function finish(latencyMs = null) {
      resolveOnce(buildJavaStatus(statusPayload, host, port, latencyMs));
    }

    socket.setTimeout(timeoutMs, () => {
      rejectOnce(
        new MinecraftToolkitError(`Timed out while querying ${host}:${port}`, { statusCode: 504 }),
      );
    });

    socket.on("error", (error) => {
      rejectOnce(makeError(`Unable to reach ${host}:${port}`, error));
    });

    socket.on("close", () => {
      if (!settled) {
        if (statusPayload) {
          finish(null);
        } else {
          rejectOnce(
            new MinecraftToolkitError(
              `Connection closed before status was received for ${host}:${port}`,
            ),
          );
        }
      }
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RECEIVE_BYTES) {
        rejectOnce(
          new MinecraftToolkitError(`Response from ${host}:${port} exceeded maximum allowed size`, {
            statusCode: 502,
          }),
        );
        return;
      }
      processPackets();
    });

    socket.connect(port, host, () => {
      try {
        socket.write(handshakePacket);
        socket.write(statusRequestPacket);
      } catch (error) {
        rejectOnce(makeError(`Failed to send status request to ${host}:${port}`, error));
      }
    });

    function processPackets() {
      while (true) {
        const packet = extractPacket();
        if (!packet) {
          break;
        }
        const { id, payload } = packet;
        if (id === 0 && !statusPayload) {
          try {
            statusPayload = parseStatusPayload(payload);
          } catch (error) {
            rejectOnce(makeError("Invalid status payload", error));
            return;
          }

          try {
            pingStartedAt = Date.now();
            socket.write(buildPingPacket(pingStartedAt));
            pingFallbackTimer = setTimeout(() => {
              if (!settled) {
                finish(null);
              }
            }, 200);
          } catch {
            finish(null);
          }
        } else if (id === 1 && statusPayload) {
          const latency = Math.max(0, Date.now() - pingStartedAt);
          finish(latency);
        }
      }
    }

    function extractPacket() {
      try {
        const { value: length, size: lengthSize } = decodeVarInt(buffer, 0);
        if (buffer.length < lengthSize + length) {
          return null;
        }
        const packetData = buffer.subarray(lengthSize, lengthSize + length);
        buffer = buffer.subarray(lengthSize + length);
        const { value: packetId, size: idSize } = decodeVarInt(packetData, 0);
        const payload = packetData.subarray(idSize);
        return { id: packetId, payload };
      } catch {
        return null;
      }
    }
  });
}

function buildHandshakePacket(host, port, protocolVersion) {
  const hostBytes = Buffer.from(host, "utf8");
  const payload = Buffer.concat([
    encodeVarInt(protocolVersion),
    encodeVarInt(hostBytes.length),
    hostBytes,
    writePort(port),
    encodeVarInt(1),
  ]);
  return createPacket(0, payload);
}

function buildStatusRequestPacket() {
  return createPacket(0, Buffer.alloc(0));
}

function buildPingPacket(timestampMs) {
  const payload = Buffer.alloc(8);
  payload.writeBigInt64BE(BigInt(timestampMs));
  return createPacket(1, payload);
}

function createPacket(packetId, payload) {
  const payloadBuffer = Buffer.concat([encodeVarInt(packetId), payload]);
  const lengthBuffer = encodeVarInt(payloadBuffer.length);
  return Buffer.concat([lengthBuffer, payloadBuffer]);
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

function decodeVarInt(buffer, offset = 0) {
  let numRead = 0;
  let result = 0;
  let byte = 0;
  do {
    if (offset + numRead >= buffer.length) {
      throw new RangeError("VarInt extends beyond buffer");
    }
    byte = buffer[offset + numRead];
    result |= (byte & 0x7f) << (7 * numRead);
    numRead += 1;
    if (numRead > 5) {
      throw new RangeError("VarInt is too big");
    }
  } while ((byte & 0x80) === 0x80);
  return { value: result, size: numRead };
}

function parseStatusPayload(payload) {
  const { value: stringLength, size } = decodeVarInt(payload, 0);
  const end = size + stringLength;
  if (payload.length < end) {
    throw new RangeError("Status string exceeds payload length");
  }
  const json = payload.subarray(size, end).toString("utf8");
  return JSON.parse(json);
}

function buildJavaStatus(payload, host, port, latencyMs) {
  const { version, players, description, favicon, ...rest } = payload;
  return {
    edition: "java",
    online: true,
    host,
    port,
    version: version ?? null,
    players: players ?? null,
    motd: stringifyDescription(description) ?? null,
    favicon: favicon ?? null,
    latencyMs,
    raw: rest,
  };
}

function stringifyDescription(description) {
  if (!description) {
    return null;
  }
  if (typeof description === "string") {
    return description;
  }
  if (Array.isArray(description)) {
    return description.map((entry) => stringifyDescription(entry) ?? "").join("");
  }
  if (typeof description === "object") {
    const text = description.text ?? "";
    const extra = Array.isArray(description.extra)
      ? description.extra.map((entry) => stringifyDescription(entry) ?? "").join("")
      : "";
    return `${text}${extra}` || null;
  }
  return null;
}

function writePort(port) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(port, 0);
  return buffer;
}
