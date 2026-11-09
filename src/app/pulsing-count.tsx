"use client";

import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { countPulse } from "./count-pulse.ts";

function subscribeToVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

// A count's number, pulsing amber when a check changes it, once the browser tab
// is visible. A new change restarts a running pulse, and reduced motion turns
// pulses off. It starts from the value it first renders, so loading a page
// never pulses; key it by what it counts so another repository's count starts
// afresh too.
export function PulsingCount({ value, className }: { value: number; className?: string }) {
  const visible = useSyncExternalStore(
    subscribeToVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
  const [{ shown, pulses }, setState] = useState({ shown: value, pulses: 0 });
  const next = countPulse({ shown, value, visible });
  if (next.shown !== shown) setState({ shown: next.shown, pulses: pulses + Number(next.pulse) });

  // A new key per pulse remounts the number, restarting its animation. Inline
  // block so the pulse can scale it inside inline text.
  return (
    <span key={pulses} className={cn("inline-block", pulses > 0 && "motion-safe:animate-count-pulse", className)}>
      {value}
    </span>
  );
}
