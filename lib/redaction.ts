const protectedFields =
  /(?:secret|password|credential|authorization|privatekey|protectionbypass|token|apikey|clientsecret|connectionstring|signingkey)/i;
const protectedContainers = new Set([
  "env",
  "envs",
  "environmentvariables",
  "buildenv",
  "token",
  "tokens",
  "headers",
  "oidctokenclaims",
  "encryptionkey",
  "decryptionkey",
  "certificatekey",
  "authcode",
]);

export function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) {
      if (!secret) continue;
      for (const encoded of [
        secret,
        encodeURIComponent(secret),
        Buffer.from(secret).toString("base64"),
      ])
        text = text.split(encoded).join("[REDACTED]");
    }
    return text
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
      .replace(
        /\b(?:vca|vcr|vcp|vercel_blob_rw|sk_live|sk_test|ghp|github_pat)_[A-Za-z0-9_-]+/g,
        "[REDACTED]",
      )
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[REDACTED]@")
      .replace(
        /([?&](?:token|secret|key|signature|x-vercel-protection-bypass)=)[^&#\s]+/gi,
        "$1[REDACTED]",
      );
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => {
          const normalized = key.replace(/[_-]/g, "");
          return (
            !protectedFields.test(normalized) &&
            !protectedContainers.has(normalized.toLowerCase())
          );
        })
        .map(([key, child]) => [
          String(redact(key, secrets)),
          redact(child, secrets),
        ]),
    );
  }
  return value;
}
