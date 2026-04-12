import crypto from "node:crypto";

export function generateRequestId(): string {
  return crypto.randomBytes(4).toString("hex");
}
