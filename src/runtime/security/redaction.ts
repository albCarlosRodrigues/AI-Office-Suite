const SENSITIVE_KEY =
  /authorization|api[-_]?key|bearer|cookie|password|private[-_]?key|secret|token/i;
const SECRET_VALUE = /(bearer\s+)[a-z0-9._~+/-]+|\b(sk-[a-z0-9_-]{12,})\b/gi;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(SECRET_VALUE, "$1[REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  return value;
}
