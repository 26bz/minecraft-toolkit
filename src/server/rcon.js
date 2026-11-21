import { Socket } from "node:net";
import { DEFAULT_RCON_PORT } from "../constants.js";
import { MinecraftToolkitError } from "../errors.js";
import { normalizeAddress } from "../utils/validation.js";
import { resolveAddress } from "../utils/network.js";
import { resolveTimeout, makeError } from "./shared.js";

const PACKET_TYPE_AUTH = 3;
const PACKET_TYPE_COMMAND = 2;
const PACKET_TYPE_RESPONSE = 0;

export function createRconClient(options = {}) {
  const { host, password, port, timeoutMs } = options;

  if (!host) {
    throw new MinecraftToolkitError("RCON host is required", { statusCode: 400 });
  }
  if (typeof password !== "string" || password.length === 0) {
    throw new MinecraftToolkitError("RCON password is required", { statusCode: 400 });
  }

  const normalizedHost = normalizeAddress(host);
  const { host: resolvedHost, port: resolvedPort } = resolveAddress(
    normalizedHost,
    port,
    DEFAULT_RCON_PORT,
  );
  const resolvedTimeout = resolveTimeout(timeoutMs);

  return new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setNoDelay(true);

    let connectSettled = false;
    let closed = false;
    let authResolved = false;
    let buffer = Buffer.alloc(0);
    let requestCounter = 1;
    const pending = new Map();
    const markers = new Map();

    function nextRequestId() {
      requestCounter = requestCounter >= 0x7fffffff ? 1 : requestCounter + 1;
      return requestCounter;
    }

    function failAll(error) {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
      markers.clear();
    }

    function finishRequest(id) {
      const request = pending.get(id);
      if (!request) {
        return;
      }
      pending.delete(id);
      markers.delete(request.markerId);
      clearTimeout(request.timer);
      request.resolve(request.chunks.join(""));
    }

    function settleConnect(fn, value) {
      if (connectSettled) {
        return;
      }
      connectSettled = true;
      fn(value);
    }

    function teardown(error) {
      closed = true;
      socket.removeAllListeners();
      socket.destroy();
      settleConnect(reject, error);
      failAll(error);
    }

    socket.setTimeout(resolvedTimeout, () => {
      teardown(
        new MinecraftToolkitError(
          `Timed out while communicating with RCON server ${resolvedHost}:${resolvedPort}`,
          { statusCode: 504 },
        ),
      );
    });

    socket.once("error", (error) => {
      teardown(makeError(`RCON connection error for ${resolvedHost}:${resolvedPort}`, error));
    });

    socket.once("close", () => {
      if (!closed) {
        teardown(
          new MinecraftToolkitError(`RCON connection to ${resolvedHost}:${resolvedPort} closed`, {
            statusCode: 502,
          }),
        );
      }
    });

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      let packet = readPacket(buffer);

      while (packet) {
        buffer = buffer.subarray(packet.consumed);

        if (!authResolved) {
          if (packet.type === PACKET_TYPE_RESPONSE) {
            // Some servers send an empty SERVERDATA_RESPONSE_VALUE before the auth response — ignore it.
          } else if (packet.id === -1) {
            teardown(
              new MinecraftToolkitError("RCON authentication failed: invalid password", {
                statusCode: 401,
              }),
            );
            return;
          } else {
            authResolved = true;
            socket.setTimeout(0);
            settleConnect(resolve, { execute: executeCommand, close: closeClient });
          }
        } else {
          if (markers.has(packet.id)) {
            finishRequest(markers.get(packet.id));
          } else {
            pending.get(packet.id)?.chunks.push(packet.body);
          }
        }

        packet = readPacket(buffer);
      }
    });

    socket.connect(resolvedPort, resolvedHost, () => {
      socket.write(encodePacket(nextRequestId(), PACKET_TYPE_AUTH, password));
    });

    function executeCommand(command) {
      if (closed) {
        return Promise.reject(
          new MinecraftToolkitError("RCON client is closed", { statusCode: 400 }),
        );
      }
      if (typeof command !== "string" || command.length === 0) {
        return Promise.reject(
          new MinecraftToolkitError("RCON command must be a non-empty string", {
            statusCode: 400,
          }),
        );
      }

      return new Promise((resolveCommand, rejectCommand) => {
        const id = nextRequestId();
        const markerId = nextRequestId();
        const timer = setTimeout(() => {
          const request = pending.get(id);
          if (request?.chunks.length) {
            finishRequest(id);
            return;
          }
          pending.delete(id);
          markers.delete(markerId);
          rejectCommand(
            new MinecraftToolkitError(
              `Timed out waiting for RCON response from ${resolvedHost}:${resolvedPort}`,
              { statusCode: 504 },
            ),
          );
        }, resolvedTimeout);
        pending.set(id, {
          resolve: resolveCommand,
          reject: rejectCommand,
          timer,
          markerId,
          chunks: [],
        });
        markers.set(markerId, id);
        socket.write(encodePacket(id, PACKET_TYPE_COMMAND, command));
        socket.write(encodePacket(markerId, PACKET_TYPE_RESPONSE, ""), (writeError) => {
          if (writeError) {
            pending.delete(id);
            markers.delete(markerId);
            clearTimeout(timer);
            rejectCommand(makeError("Failed to send RCON command", writeError));
          }
        });
      });
    }

    function closeClient() {
      if (closed) {
        return;
      }
      closed = true;
      socket.removeAllListeners();
      socket.destroy();
      failAll(new MinecraftToolkitError("RCON client is closed", { statusCode: 400 }));
    }
  });
}

export async function sendRconCommand(options = {}) {
  const { command, ...clientOptions } = options;
  const client = await createRconClient(clientOptions);
  try {
    return await client.execute(command);
  } finally {
    client.close();
  }
}

function encodePacket(id, type, body) {
  const bodyBuffer = Buffer.from(body, "utf8");
  const payloadLength = 4 + 4 + bodyBuffer.length + 2;
  const packet = Buffer.alloc(4 + payloadLength);
  packet.writeInt32LE(payloadLength, 0);
  packet.writeInt32LE(id, 4);
  packet.writeInt32LE(type, 8);
  bodyBuffer.copy(packet, 12);
  packet.writeUInt8(0, 12 + bodyBuffer.length);
  packet.writeUInt8(0, 12 + bodyBuffer.length + 1);
  return packet;
}

function readPacket(buffer) {
  if (buffer.length < 4) {
    return null;
  }
  const length = buffer.readInt32LE(0);
  if (length < 10 || buffer.length < 4 + length) {
    return null;
  }
  const id = buffer.readInt32LE(4);
  const type = buffer.readInt32LE(8);
  const body = buffer.toString("utf8", 12, 4 + length - 2);
  return { id, type, body, consumed: 4 + length };
}
