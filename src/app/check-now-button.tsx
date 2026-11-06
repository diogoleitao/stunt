"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCheck } from "./checks.tsx";

// Checks at once, `repository` alone when given, spinning until the check is
// done. A failed check tints the button and names the failure until a check
// succeeds or the tab reloads. The same check asked for from the switcher
// shows here too.
export function CheckNowButton({ repository }: { repository?: string }) {
  const { checking, failure, check } = useCheck(repository);

  const action = repository === undefined ? "Check now" : `Check ${repository} now`;
  const label = failure === undefined ? action : `Check failed: ${failure}. Check again`;
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} disabled={checking} onClick={check}>
      <RefreshCw className={cn(checking && "animate-spin", failure !== undefined && "text-destructive")} />
    </Button>
  );
}
