import crypto from "node:crypto";

export const generateRequestId = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(4))).toString("hex");
