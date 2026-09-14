import { randomUUID } from "node:crypto";
import type { ModelCandidate } from "@/orchestration/model-routing";
import type { ModelTier } from "@/orchestration/contracts";
import { DurableRuntimeStore } from "./store.server";
import { addOutbox, audit, iso, metric, plusMs } from "./helpers";

export interface EconomicCandidate extends ModelCandidate {
  estimatedCost: number;
  toolSupport: boolean;
  structuredOutputSupport: boolean;
  permitted: boolean;
  healthy: boolean;
}

export class DurableBudgetService {
  constructor(private readonly store: DurableRuntimeStore) {}

  reserve(
    input: {
      missionId: string;
      taskId: string;
      provider: string;
      model: string;
      estimatedInputTokens: number;
      reservedOutputTokens: number;
      reservedCost: number;
      missionLimit: number;
      ttlMs?: number;
    },
    now = Date.now(),
  ) {
    return this.store.transaction((state) => {
      const consumed = state.budgetReservations
        .filter(
          (item) =>
            item.missionId === input.missionId && ["RESERVED", "CONSUMED"].includes(item.status),
        )
        .reduce(
          (sum, item) =>
            sum +
            (item.status === "CONSUMED"
              ? (item.actualCost ?? item.reservedCost)
              : item.reservedCost),
          0,
        );
      if (consumed + input.reservedCost > input.missionLimit) {
        metric(state, "budget_denial_count", 1, input, now);
        return null;
      }
      const reservation = {
        reservationId: randomUUID(),
        ...input,
        status: "RESERVED" as const,
        createdAt: iso(now),
        expiresAt: plusMs(input.ttlMs ?? 300_000, now),
        reconciledAt: null,
        actualTokens: null,
        actualCost: null,
      };
      state.budgetReservations.push(reservation);
      audit(state, "BUDGET_RESERVED", input, { reservationId: reservation.reservationId }, now);
      return structuredClone(reservation);
    });
  }

  async routeAndReserve(
    input: {
      missionId: string;
      taskId: string;
      missionLimit: number;
      desiredTier: ModelTier;
      candidates: EconomicCandidate[];
      requiredCapabilities: string[];
      minimumContext: number;
      requiresTools: boolean;
      requiresStructuredOutput: boolean;
      estimatedInputTokens: number;
      reservedOutputTokens: number;
    },
    now = Date.now(),
  ) {
    const tiers: Record<ModelTier, number> = {
      TIER_0: 0,
      TIER_1: 1,
      TIER_2: 2,
      TIER_3: 3,
      TIER_4: 4,
    };
    const capable = input.candidates
      .filter((item) => item.available && item.healthy && item.permitted)
      .filter((item) => tiers[item.tier] <= tiers[input.desiredTier])
      .filter((item) => item.contextWindow >= input.minimumContext)
      .filter((item) =>
        input.requiredCapabilities.every((capability) => item.capabilities.includes(capability)),
      )
      .filter((item) => !input.requiresTools || item.toolSupport)
      .filter((item) => !input.requiresStructuredOutput || item.structuredOutputSupport)
      .sort(
        (a, b) => tiers[input.desiredTier] - tiers[a.tier] || a.estimatedCost - b.estimatedCost,
      );
    for (const candidate of capable) {
      const reservation = await this.reserve(
        {
          missionId: input.missionId,
          taskId: input.taskId,
          provider: candidate.provider,
          model: candidate.model,
          estimatedInputTokens: input.estimatedInputTokens,
          reservedOutputTokens: input.reservedOutputTokens,
          reservedCost: candidate.estimatedCost,
          missionLimit: input.missionLimit,
        },
        now,
      );
      if (reservation) {
        if (candidate.tier !== input.desiredTier)
          await this.store.transaction((state) => {
            audit(
              state,
              "MODEL_TIER_DOWNGRADED",
              input,
              { from: input.desiredTier, to: candidate.tier },
              now,
            );
            metric(state, "tier_downgrade_count", 1, input, now);
          });
        return { candidate, reservation };
      }
    }
    await this.store.transaction((state) => {
      const task = state.tasks.find((item) => item.id === input.taskId);
      if (task) task.status = "BUDGET_BLOCKED";
    });
    return null;
  }

  reconcile(reservationId: string, actualTokens: number, actualCost: number, now = Date.now()) {
    return this.store.transaction((state) => {
      const item = state.budgetReservations.find(
        (reservation) => reservation.reservationId === reservationId,
      );
      if (!item) throw new Error("BUDGET_RESERVATION_NOT_FOUND");
      if (item.status === "CONSUMED") return false;
      if (item.status !== "RESERVED") throw new Error("BUDGET_RESERVATION_NOT_ACTIVE");
      item.status = "CONSUMED";
      item.actualTokens = actualTokens;
      item.actualCost = actualCost;
      item.reconciledAt = iso(now);
      return true;
    });
  }

  release(reservationId: string, now = Date.now()) {
    return this.store.transaction((state) => {
      const item = state.budgetReservations.find(
        (reservation) => reservation.reservationId === reservationId,
      );
      if (!item || item.status !== "RESERVED") return false;
      item.status = "RELEASED";
      item.reconciledAt = iso(now);
      audit(state, "BUDGET_RELEASED", item, { reason: "provider_not_invoked" }, now);
      return true;
    });
  }
}
