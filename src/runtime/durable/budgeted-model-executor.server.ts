import { DurableBudgetService, type EconomicCandidate } from "./budget-service.server";

export interface BudgetedModelResult<T> {
  status: "COMPLETED" | "BUDGET_BLOCKED";
  candidate?: EconomicCandidate;
  output?: T;
}

export class DurableBudgetedModelExecutor {
  constructor(private readonly budgets: DurableBudgetService) {}

  async execute<T>(
    routing: Parameters<DurableBudgetService["routeAndReserve"]>[0],
    invoke: (candidate: EconomicCandidate) => Promise<{
      output: T;
      actualTokens: number;
      actualCost: number;
    }>,
    now = Date.now(),
  ): Promise<BudgetedModelResult<T>> {
    const selected = await this.budgets.routeAndReserve(routing, now);
    if (!selected) return { status: "BUDGET_BLOCKED" };
    try {
      const result = await invoke(selected.candidate);
      await this.budgets.reconcile(
        selected.reservation.reservationId,
        result.actualTokens,
        result.actualCost,
        now,
      );
      return { status: "COMPLETED", candidate: selected.candidate, output: result.output };
    } catch (error) {
      await this.budgets.release(selected.reservation.reservationId, now);
      throw error;
    }
  }
}
