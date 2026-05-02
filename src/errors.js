export class MinecraftToolkitError extends Error {
  constructor(message, { statusCode = 500, cause, retryAfter } = {}) {
    super(message, { cause });
    this.name = "MinecraftToolkitError";
    this.statusCode = statusCode;
    if (retryAfter !== undefined) {
      this.retryAfter = retryAfter;
    }
  }
}
