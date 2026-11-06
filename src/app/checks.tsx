"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import type { CheckFailure } from "./check/answer.ts";
import { useCheckStream } from "./check-stream.tsx";

// The key of a check of every repository; a Repository check is keyed by its
// owner/repo.
const EVERY = "";

type Checks = {
  // The keys of the checks this tab asked for that have not answered yet.
  checking: ReadonlySet<string>;
  // Why the last check this tab asked for of each key failed, until a check
  // succeeds or the tab reloads.
  failures: Readonly<Record<string, string>>;
  check(repository?: string): void;
};

const ChecksContext = createContext<Checks | null>(null);

// Why the server's check failed, from its answer.
async function failureOf(response: Response): Promise<string> {
  const { error } = (await response.json().catch(() => ({}))) as Partial<CheckFailure>;
  return error ?? `${response.status} ${response.statusText}`;
}

// `failures` with the failure of `key` set to `failure`, or cleared when it
// is undefined.
function withFailure(failures: Readonly<Record<string, string>>, key: string, failure: string | undefined) {
  const { [key]: _, ...rest } = failures;
  return failure === undefined ? rest : { ...rest, [key]: failure };
}

// Asks the server for checks for every component below it, which share each
// check's progress and failure, so a check asked for from the switcher shows
// on the button that stands for it. Must be inside CheckStream.
export function Checks({ children }: { children: ReactNode }) {
  const asked = useRef(new Set<string>());
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Readonly<Record<string, string>>>({});

  useCheckStream(() => setFailures({}));

  async function check(repository?: string) {
    const key = repository ?? EVERY;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    setChecking(new Set(asked.current));
    let failure: string | undefined;
    try {
      const response = await fetch(repository === undefined ? "/check" : `/check/${repository}`, { method: "POST" });
      failure = response.ok ? undefined : await failureOf(response);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      asked.current.delete(key);
      setChecking(new Set(asked.current));
    }
    setFailures((current) => withFailure(current, key, failure));
  }

  return (
    <ChecksContext value={{ checking, failures, check: (repository) => void check(repository) }}>
      {children}
    </ChecksContext>
  );
}

// The check of `repository`, as owner/repo, or of every repository when
// unset: whether it is running, why it last failed, and asking for it.
export function useCheck(repository?: string) {
  const checks = useContext(ChecksContext);
  if (checks === null) throw new Error("useCheck must be used inside Checks");
  const key = repository ?? EVERY;
  return {
    checking: checks.checking.has(key),
    failure: checks.failures[key],
    check: () => checks.check(repository),
  };
}
