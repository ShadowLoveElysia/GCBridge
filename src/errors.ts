export class BridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof BridgeError) return { code: error.code, message: error.message };
  // SDK and filesystem errors can contain credentials, prompts or local paths.
  return {
    code: "INTERNAL_ERROR",
    message: "Operation failed. Check configuration and local storage permissions.",
  };
}
