/**
 * Structured logging for MOVA.
 *
 * Conventions (see docs/conventions.md):
 * - Always JSON (or readable pretty) with a stable set of top-level fields.
 * - A `correlationId` is threaded through every log line of one payment flow.
 * - Secrets and PII are redacted by field name — never log keys, mnemonics,
 *   private keys, passwords, or full counterparty identity.
 * - `child()` derives a scoped logger without mutating the parent.
 *
 * This is intentionally dependency-free in Phase 0. In production it can be
 * swapped for pino with the same shape (the `Logger` interface is the contract).
 */

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export const LOG_LEVEL_ORDER: readonly LogLevel[] = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
];

const LEVEL_RANK: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

/** Arbitrary structured context. `correlationId` is special-cased but optional. */
export interface LogContext {
  correlationId?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: "json" | "pretty";
  /** Field names whose values are always redacted (case-insensitive). */
  redactFields?: string[];
  /** Static fields attached to every line (service, env, version...). */
  baseFields?: Record<string, unknown>;
  /** Sink override (defaults to console) for tests. */
  sink?: (line: string) => void;
}

export interface Logger {
  fatal(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  trace(message: string, context?: LogContext): void;
  /** Derived logger with extra static context (e.g. { correlationId }). */
  child(extra: LogContext): Logger;
}

const DEFAULT_REDACT = [
  "password",
  "secret",
  "apikey",
  "key",
  "mnemonic",
  "privatekey",
  "authorization",
  "token",
];

/** Deep-redact values whose key matches a redact field (case-insensitive). */
function redact(value: unknown, redactSet: ReadonlySet<string>, depth = 0): unknown {
  if (depth > 6) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, redactSet, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSet.has(k.toLowerCase()) ? "[REDACTED]" : redact(v, redactSet, depth + 1);
    }
    return out;
  }
  return value;
}

function formatLevel(level: LogLevel): string {
  return level.toUpperCase().padEnd(5);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const threshold = LEVEL_RANK[level];
  const format = options.format ?? "json";
  const redactSet = new Set(
    [...DEFAULT_REDACT, ...(options.redactFields ?? [])].map((f) => f.toLowerCase()),
  );
  const base = options.baseFields ?? {};
  const sink = options.sink ?? ((line: string) => console.log(line));

  const write = (lvl: LogLevel, message: string, context?: LogContext): void => {
    if (LEVEL_RANK[lvl] < threshold) return;
    const safe = { ...base, ...(context ?? {}) } as Record<string, unknown>;
    const redacted = redact(safe, redactSet) as Record<string, unknown>;
    const record = {
      time: new Date().toISOString(),
      level: lvl,
      msg: message,
      ...redacted,
    };
    sink(
      format === "json"
        ? JSON.stringify(record)
        : `${formatLevel(lvl)} ${message} ${JSON.stringify(redact(safe, redactSet))}`,
    );
  };

  const child = (extra: LogContext): Logger =>
    createLogger({
      level,
      format,
      redactFields: [...redactSet],
      baseFields: { ...base, ...extra },
      sink,
    });

  return {
    fatal: (m, c) => write("fatal", m, c),
    error: (m, c) => write("error", m, c),
    warn: (m, c) => write("warn", m, c),
    info: (m, c) => write("info", m, c),
    debug: (m, c) => write("debug", m, c),
    trace: (m, c) => write("trace", m, c),
    child,
  };
}

/** Null logger for tests / dead paths. */
export function createNullLogger(): Logger {
  return {
    fatal: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    trace: () => {},
    child: () => createNullLogger(),
  };
}
