import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type {
  LocalDatabaseOperation,
  LocalDatabaseResult,
  LocalFilter,
  LocalRpcOperation,
} from "./database.shared";

type Executor = (
  payload: { operation: LocalDatabaseOperation } | { rpc: LocalRpcOperation },
) => Promise<LocalDatabaseResult>;

class LocalQuery implements PromiseLike<LocalDatabaseResult> {
  private operation: LocalDatabaseOperation;

  constructor(
    table: string,
    private readonly executePayload: Executor,
  ) {
    this.operation = { table, action: "select", filters: [], columns: "*" };
  }

  select(columns = "*") {
    this.operation.columns = columns;
    if (this.operation.action !== "select") this.operation.returning = true;
    return this;
  }
  insert(values: unknown) {
    this.operation.action = "insert";
    this.operation.values = values;
    return this;
  }
  update(values: unknown) {
    this.operation.action = "update";
    this.operation.values = values;
    return this;
  }
  upsert(values: unknown, options?: { onConflict?: string }) {
    this.operation.action = "upsert";
    this.operation.values = values;
    if (options?.onConflict) this.operation.onConflict = options.onConflict;
    return this;
  }
  delete() {
    this.operation.action = "delete";
    return this;
  }
  private filter(op: LocalFilter["op"], column: string, value: unknown) {
    this.operation.filters.push({ op, column, value });
    return this;
  }
  eq(column: string, value: unknown) {
    return this.filter("eq", column, value);
  }
  neq(column: string, value: unknown) {
    return this.filter("neq", column, value);
  }
  in(column: string, value: unknown[]) {
    return this.filter("in", column, value);
  }
  is(column: string, value: unknown) {
    return this.filter("is", column, value);
  }
  lt(column: string, value: unknown) {
    return this.filter("lt", column, value);
  }
  lte(column: string, value: unknown) {
    return this.filter("lte", column, value);
  }
  gt(column: string, value: unknown) {
    return this.filter("gt", column, value);
  }
  gte(column: string, value: unknown) {
    return this.filter("gte", column, value);
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.operation.order = { column, ascending: options?.ascending ?? true };
    return this;
  }
  limit(value: number) {
    this.operation.limit = value;
    return this;
  }
  single() {
    this.operation.cardinality = "single";
    return this;
  }
  maybeSingle() {
    this.operation.cardinality = "maybeSingle";
    return this;
  }
  then<TResult1 = LocalDatabaseResult, TResult2 = never>(
    onfulfilled?: ((value: LocalDatabaseResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.executePayload({ operation: this.operation }).then(onfulfilled, onrejected);
  }
}

export function createLocalClient(executor: Executor): SupabaseClient<Database> {
  const client = {
    from: (table: string) => new LocalQuery(table, executor),
    rpc: (name: string, args?: Record<string, unknown>) =>
      executor({ rpc: args ? { name, args } : { name } }),
    channel: () => {
      const channel = {
        on: () => channel,
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: async () => ({ data: "ok", error: null }),
  };
  return client as unknown as SupabaseClient<Database>;
}

export const localClient = createLocalClient(async (payload) => {
  const response = await fetch("/api/local-db", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    return { data: null, error: { message: await response.text() } };
  }
  return (await response.json()) as LocalDatabaseResult;
});
