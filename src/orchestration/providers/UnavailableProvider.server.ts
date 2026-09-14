import type { ProviderHealth, ProviderType } from "@/types/domain";
import type {
  AgentProvider,
  ExecInput,
  MeetingTurnInput,
  PlanInput,
  ReviewInput,
  SummaryInput,
} from "./types";

export class UnavailableProvider implements AgentProvider {
  readonly simulated = false;
  readonly model = "provider-not-connected";

  constructor(
    readonly type: ProviderType,
    private reason: string,
  ) {}

  private fail(): never {
    throw new Error(`PROVIDER_NOT_CONNECTED: ${this.reason}`);
  }

  async plan(_input: PlanInput) {
    return this.fail();
  }
  async executeTask(_input: ExecInput) {
    return this.fail();
  }
  async review(_input: ReviewInput) {
    return this.fail();
  }
  async meetingTurn(_input: MeetingTurnInput) {
    return this.fail();
  }
  async summarize(_input: SummaryInput) {
    return this.fail();
  }
  async healthCheck(): Promise<{ health: ProviderHealth; latencyMs: number; message: string }> {
    return { health: "UNCONFIGURED", latencyMs: 0, message: this.reason };
  }
}
