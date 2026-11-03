"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CheckFailure } from "./check/route.ts";
import { useCheckStream } from "./check-stream.tsx";

// Why the server's check failed, from its answer.
async function failureOf(response: Response): Promise<string> {
  const { error } = (await response.json().catch(() => ({}))) as Partial<CheckFailure>;
  return error ?? `${response.status} ${response.statusText}`;
}

// Checks at once, spinning until the check is done. A failed check tints the
// button and names the failure until a check succeeds or the tab reloads.
export function CheckNowButton() {
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<string>();

  useCheckStream(() => setFailure(undefined));

  async function checkNow() {
    setChecking(true);
    try {
      const response = await fetch("/check", { method: "POST" });
      setFailure(response.ok ? undefined : await failureOf(response));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }

  const label = failure === undefined ? "Check now" : `Check failed: ${failure}. Check again`;
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} disabled={checking} onClick={checkNow}>
      <RefreshCw className={cn(checking && "animate-spin", failure !== undefined && "text-destructive")} />
    </Button>
  );
}
