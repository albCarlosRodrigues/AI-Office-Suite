import { z } from "zod";
import type { ExecutionBackend, ExecutionInput } from "@/orchestration/execution-backend";

export const PrxReply = z
  .object({
    requestId: z.string(),
    sessionId: z.string(),
    conversationId: z.string(),
    agentId: z.string(),
    messageId: z.string().min(1),
    text: z.string().min(1),
  })
  .strict();
export type PrxReply = z.infer<typeof PrxReply>;
export interface PrxRequest {
  requestId: string;
  sessionId: string;
  conversationId: string;
  agentId: string;
  missionId: string;
  taskId: string;
  agentRunId: string;
  lastMessageId: string | null;
  prompt: string;
}
export interface PrxSessionClient {
  health(signal: AbortSignal): Promise<boolean>;
  send(request: PrxRequest, signal: AbortSignal): Promise<void>;
  receive(request: PrxRequest, signal: AbortSignal): Promise<unknown>;
  close(): void;
}
export const ChatPayload = z.object({ system: z.string(), user: z.string(), json: z.boolean() });
const locks = new Set<string>();
async function interruptible<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Transport only: a correlated response never establishes tool execution evidence. */
export class PrxChatBackend implements ExecutionBackend {
  readonly id = "prx-localant";
  readonly capabilities = {
    plan: true,
    execute: true,
    review: true,
    tools: [],
    supportsSessionResume: true,
  };
  private lastMessageId: string | null = null;
  constructor(
    private client: PrxSessionClient,
    private config: {
      sessionId: string;
      conversationId: string;
      agentId: string;
      timeoutMs: number;
    },
  ) {}
  async healthCheck() {
    const ok = await this.client
      .health(AbortSignal.timeout(this.config.timeoutMs))
      .catch(() => false);
    this.client.close();
    return {
      status: ok ? ("HEALTHY" as const) : ("UNAVAILABLE" as const),
      message: ok ? "PRX session reachable; response not tested" : "PRX session unavailable",
    };
  }
  async execute(input: ExecutionInput, signal?: AbortSignal) {
    const payload = ChatPayload.parse(input.payload);
    const deadline = AbortSignal.timeout(this.config.timeoutMs);
    const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
    abort.throwIfAborted();
    const key = this.config.sessionId;
    if (locks.has(key)) throw new Error("PRX_SESSION_BUSY");
    locks.add(key);
    const request: PrxRequest = {
      ...this.config,
      requestId: crypto.randomUUID(),
      missionId: input.missionId ?? "probe",
      taskId: input.taskId,
      agentRunId: input.agentRunId ?? crypto.randomUUID(),
      lastMessageId: this.lastMessageId,
      prompt: JSON.stringify({ system: payload.system, user: payload.user }),
    };
    try {
      await interruptible(this.client.send(request, abort), abort);
      while (true) {
        abort.throwIfAborted();
        const reply = PrxReply.safeParse(
          await interruptible(this.client.receive(request, abort), abort),
        );
        if (!reply.success) continue;
        const r = reply.data;
        if (
          r.requestId !== request.requestId ||
          r.sessionId !== request.sessionId ||
          r.conversationId !== request.conversationId ||
          r.agentId !== request.agentId ||
          r.messageId === request.lastMessageId
        )
          continue;
        this.lastMessageId = r.messageId;
        return {
          status: "COMPLETED" as const,
          result: r.text,
          backendId: this.id,
          fallbackCount: 0,
        };
      }
    } finally {
      locks.delete(key);
      this.client.close();
    }
  }
}
