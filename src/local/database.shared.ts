export type LocalFilter = {
  op: "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte";
  column: string;
  value: unknown;
};

export type LocalDatabaseOperation = {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  values?: unknown;
  columns?: string;
  filters: LocalFilter[];
  order?: { column: string; ascending: boolean };
  limit?: number;
  cardinality?: "single" | "maybeSingle";
  onConflict?: string;
  returning?: boolean;
};

export type LocalRpcOperation = { name: string; args?: Record<string, unknown> };

export type LocalDatabaseResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
