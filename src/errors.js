export class MinecraftToolkitError extends Error {
  constructor(message, { statusCode = 500, cause } = {}) {
    super(message);
    this.name = "MinecraftToolkitError";
    this.statusCode = statusCode;
    this.cause = cause;
  }
}
