export interface ContextParts {
  systemTokens: number;
  taskTokens: number;
  dependencyTokens: number;
  artifactTokens: number;
  reservedOutputTokens: number;
}
export interface Tokenizer {
  estimate(text: string): number;
}
export class HeuristicTokenizer implements Tokenizer {
  estimate(text: string) {
    return Math.ceil(new TextEncoder().encode(text).length / 4);
  }
}
export class ContextBudgeter {
  constructor(private readonly tokenizer: Tokenizer = new HeuristicTokenizer()) {}
  estimate(text: string) {
    return this.tokenizer.estimate(text);
  }
  fits(parts: ContextParts, modelWindow: number, agentLimit: number) {
    const used = Object.values(parts).reduce((sum, value) => sum + value, 0);
    const limit = Math.min(modelWindow, agentLimit);
    return { fits: used <= limit, used, limit, remaining: Math.max(0, limit - used) };
  }
}
