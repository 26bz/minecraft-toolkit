export class MinecraftToolkitError extends Error {
  constructor(message, { statusCode = 500, cause } = {}) {
    super(message, { cause });
    this.name = "MinecraftToolkitError";
    this.statusCode = statusCode;
  }
}
