import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

const forbiddenV4 = (address: string) => {
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
};

const forbiddenV6 = (address: string) => {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
};

export type HostResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

export class NetworkGuard {
  constructor(
    private readonly resolver: HostResolver = (hostname) => lookup(hostname, { all: true }),
    private readonly allowedPorts = new Set([80, 443]),
  ) {}

  async assertSafe(raw: string) {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("NETWORK_PROTOCOL_DENIED");
    if (url.username || url.password) throw new Error("NETWORK_CREDENTIALS_DENIED");
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!this.allowedPorts.has(port)) throw new Error("NETWORK_PORT_DENIED");
    const addresses = isIP(url.hostname)
      ? [{ address: url.hostname, family: isIP(url.hostname) }]
      : await this.resolver(url.hostname);
    if (!addresses.length) throw new Error("NETWORK_HOST_UNRESOLVED");
    if (
      addresses.some(({ address, family }) =>
        family === 4 ? forbiddenV4(address) : forbiddenV6(address),
      )
    )
      throw new Error("NETWORK_PRIVATE_ADDRESS_DENIED");
    return url;
  }

  async fetch(raw: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
    let current = await this.assertSafe(raw);
    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
      const response = await fetch(current, { ...init, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      if (!location || redirect === maxRedirects) throw new Error("NETWORK_REDIRECT_DENIED");
      current = await this.assertSafe(new URL(location, current).toString());
    }
    throw new Error("NETWORK_REDIRECT_DENIED");
  }
}

export function assertMissionScope(expectedMissionId: string, actualMissionId: string) {
  if (expectedMissionId !== actualMissionId) throw new Error("CROSS_MISSION_ACCESS_DENIED");
}
