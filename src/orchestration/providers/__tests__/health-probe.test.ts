import { describe, expect, it } from "vitest";

import { OpenAiCompatProvider } from "../OpenAiCompatProvider.server";

describe("provider non-invasive health probe", () => {
  it("does not call transport execution when a health probe is available", async () => {
    let transportCalls = 0;
    let healthCalls = 0;

    const provider = new OpenAiCompatProvider({
      type: "custom",
      baseUrl: "",
      apiKey: null,
      model: "chatgpt-session",
      temperature: 0.2,
      maxTokens: 4096,
      timeoutMs: 1000,
      headers: {},

      healthProbe: async () => {
        healthCalls++;

        return {
          health: "CONNECTED",
          latencyMs: 1,
          message: "PRX session reachable",
        };
      },

      transport: async () => {
        transportCalls++;

        return {
          text: "OK",
          usage: {
            tokensIn: 0,
            tokensOut: 0,
            latencyMs: 0,
            model: "chatgpt-session",
            simulated: false,
          },
        };
      },
    });

    const result = await provider.healthCheck();

    expect(result.health).toBe("CONNECTED");

    expect(healthCalls).toBe(1);

    expect(transportCalls).toBe(0);
  });
});
