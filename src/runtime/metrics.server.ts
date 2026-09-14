import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { redact } from "./security/redaction";

export interface RuntimeMetric {
  name: string;
  value: number;
  unit: "ms" | "count" | "tokens" | "usd";
  timestamp: string;
  missionId?: string;
  taskId?: string;
  provider?: string;
  model?: string;
  attributes?: Record<string, unknown>;
}
export class RuntimeMetricsStore {
  private queue = Promise.resolve();
  constructor(private readonly file: string) {}
  record(metric: RuntimeMetric): Promise<void> {
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, `${JSON.stringify(redact(metric))}\n`);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async query(filter: Partial<Pick<RuntimeMetric, "name" | "missionId" | "taskId">> = {}) {
    let content: string;
    try {
      content = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RuntimeMetric)
      .filter((metric) =>
        Object.entries(filter).every(
          ([key, value]) => metric[key as keyof RuntimeMetric] === value,
        ),
      );
  }
}
export function runtimeMetricsStore() {
  const dataFile = process.env["AI_OFFICE_DATA_FILE"] ?? `${process.cwd()}/data/ai-office.json`;
  return new RuntimeMetricsStore(
    process.env["AI_OFFICE_METRICS_FILE"] ?? `${dirname(dataFile)}/ai-office-metrics.jsonl`,
  );
}
