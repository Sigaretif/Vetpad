import { inspect } from "node:util";
import { type MockInstance, vi } from "vitest";

// The console, as a test reads it: every call is recorded and silenced. One helper for the
// reporter's tests and the routes' tests, so an assertion that an entry is there and an
// assertion that a piece of data is nowhere in the output read the same record.

const METHODS = ["log", "info", "warn", "error", "debug"] as const;

export type ConsoleMethod = (typeof METHODS)[number];

/** One console call as the capture saw it. */
export interface ConsoleEntry {
  method: ConsoleMethod;
  args: unknown[];
}

export interface ConsoleCapture {
  /** Every call, in the order it was made. */
  entries: () => ConsoleEntry[];
  /** Every argument of every call as one text — what a search for leaked data reads. */
  text: () => string;
}

let spies: MockInstance[] = [];

/** `inspect` rather than `JSON.stringify`: an `Error` serialises to `{}` and would hide its message. */
function serialise(arg: unknown): string {
  if (typeof arg === "string") return arg;
  return inspect(arg, { depth: null, maxArrayLength: null, maxStringLength: null, breakLength: Infinity });
}

/** Replaces the console's methods with recorders. Pair it with `restoreConsole` in `afterEach`. */
export function captureConsole(): ConsoleCapture {
  restoreConsole();
  const recorded: ConsoleEntry[] = [];
  spies = METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      recorded.push({ method, args });
    }),
  );
  return {
    entries: () => [...recorded],
    text: () => recorded.map((entry) => entry.args.map(serialise).join(" ")).join("\n"),
  };
}

/** Puts the real console back. */
export function restoreConsole(): void {
  for (const spy of spies) spy.mockRestore();
  spies = [];
}
