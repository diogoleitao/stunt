"use client";

import { createContext, type ReactNode, useContext, useEffect, useEffectEvent, useState } from "react";
import type { LiveUpdate } from "./app-stunt.ts";

type Listener = (update: LiveUpdate) => void;

const Listeners = createContext<Set<Listener> | null>(null);

// Holds the tab's one stream of checks, told to every component that listens
// with `useCheckStream` below it.
export function CheckStream({ children }: { children: ReactNode }) {
  const [listeners] = useState(() => new Set<Listener>());

  useEffect(() => {
    const events = new EventSource("/events");
    events.onmessage = (event) => {
      const update = JSON.parse(event.data) as LiveUpdate;
      for (const listener of listeners) listener(update);
    };
    return () => events.close();
  }, [listeners]);

  return <Listeners value={listeners}>{children}</Listeners>;
}

// Calls `onCheck` with every check the tab hears while mounted.
export function useCheckStream(onCheck: Listener) {
  const listeners = useContext(Listeners);
  if (listeners === null) throw new Error("useCheckStream must be used inside CheckStream");
  const heard = useEffectEvent(onCheck);

  useEffect(() => {
    const listener: Listener = (update) => heard(update);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listeners]);
}
