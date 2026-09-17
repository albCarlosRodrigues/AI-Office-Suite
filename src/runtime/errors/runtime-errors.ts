import { ZodError } from "zod";

export type RuntimeErrorCategory = "TRANSIENT" | "CORRECTABLE" | "PERMISSION" | "POLICY" | "FATAL";

export interface RuntimeErrorShape {
  code: string;
  category: RuntimeErrorCategory;
  retryable: boolean;
  message: string;
  suggestedAction?: string;
  causeCode?: string;
}

const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "PROVIDER_RATE_LIMITED",
  "HTTP_429",
  "HTTP_502",
  "HTTP_503",
  "HTTP_504",
  "PROCESS_TIMEOUT",
]);

const CORRECTABLE_CODES = new Set([
  "EISDIR",
  "ENOENT",
  "EINVAL",
  "PATH_IS_DIRECTORY",
  "FILE_NOT_FOUND",
  "INVALID_ARGUMENT",
  "INVALID_PATCH",
  "TEST_TARGET_NOT_FOUND",
  "ZOD_VALIDATION_ERROR",
  "TOOL_EXIT_NONZERO",
]);

const PERMISSION_CODES = new Set(["APPROVAL_REQUIRED", "PERMISSION_DENIED", "MISSING_CAPABILITY"]);

const POLICY_CODES = new Set([
  "DENY",
  "PATH_DENIED",
  "PATH_OUTSIDE_ALLOWED_ROOTS",
  "COMMAND_DENIED",
  "POLICY_DENIED",
  "SCOPE_VIOLATION",
  "LOCALANT_POLICY_DENIED",
  "policy_denied",
]);

function codeFrom(error: unknown): string {
  if (error instanceof RuntimeToolError) return error.code;
  if (error instanceof ZodError) return "ZOD_VALIDATION_ERROR";
  if (typeof error === "object" && error !== null && "code" in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value === "string" && value.trim()) return value;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] ?? "RUNTIME_TOOL_FAILED";
}

export class RuntimeToolError extends Error implements RuntimeErrorShape {
  readonly code: string;
  readonly category: RuntimeErrorCategory;
  readonly retryable: boolean;
  readonly suggestedAction?: string;
  readonly causeCode?: string;

  constructor(shape: RuntimeErrorShape, options?: ErrorOptions) {
    super(shape.message, options);
    this.name = "RuntimeToolError";
    this.code = shape.code;
    this.category = shape.category;
    this.retryable = shape.retryable;
    if (shape.suggestedAction !== undefined) {
      this.suggestedAction = shape.suggestedAction;
    }

    if (shape.causeCode !== undefined) {
      this.causeCode = shape.causeCode;
    }
  }

  toJSON(): RuntimeErrorShape {
    return {
      code: this.code,
      category: this.category,
      retryable: this.retryable,
      message: this.message,
      ...(this.suggestedAction ? { suggestedAction: this.suggestedAction } : {}),
      ...(this.causeCode ? { causeCode: this.causeCode } : {}),
    };
  }
}

export function classifyRuntimeError(error: unknown): RuntimeToolError {
  if (error instanceof RuntimeToolError) return error;
  const code = codeFrom(error);
  const message = error instanceof Error ? error.message : String(error);

  if (TRANSIENT_CODES.has(code)) {
    return new RuntimeToolError(
      { code, category: "TRANSIENT", retryable: true, message, causeCode: code },
      { cause: error },
    );
  }

  if (PERMISSION_CODES.has(code) || message.startsWith("APPROVAL_REQUIRED")) {
    return new RuntimeToolError(
      { code, category: "PERMISSION", retryable: false, message, causeCode: code },
      { cause: error },
    );
  }

  if (POLICY_CODES.has(code) || /(?:POLICY|PATH|COMMAND)_DENIED/.test(message)) {
    return new RuntimeToolError(
      { code, category: "POLICY", retryable: false, message, causeCode: code },
      { cause: error },
    );
  }

  if (CORRECTABLE_CODES.has(code) || error instanceof ZodError) {
    const suggestedAction =
      code === "EISDIR" || code === "PATH_IS_DIRECTORY"
        ? "Use a directory listing operation or select a file path."
        : undefined;
    return new RuntimeToolError(
      {
        code,
        category: "CORRECTABLE",
        retryable: false,
        message,
        causeCode: code,
        ...(suggestedAction ? { suggestedAction } : {}),
      },
      { cause: error },
    );
  }

  return new RuntimeToolError(
    { code, category: "FATAL", retryable: false, message, causeCode: code },
    { cause: error },
  );
}

export function isAutomaticRetryAllowed(error: unknown): boolean {
  return classifyRuntimeError(error).category === "TRANSIENT";
}
