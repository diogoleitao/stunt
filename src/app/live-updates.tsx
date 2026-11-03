"use client";

import { BellRing } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useCheckStream } from "./check-stream.tsx";
import { repositoryHref } from "./repository-href.ts";

// Whether this browser can show Notifications.
function supported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

// Refreshes the page after every check and shows the check's Notifications.
// Asks for permission to show them on load, and offers a button to ask again
// while permission is neither granted nor denied.
export function LiveUpdates() {
  const router = useRouter();
  const [permission, setPermission] = useState<NotificationPermission>();

  function ask() {
    void Notification.requestPermission().then(setPermission);
  }

  useEffect(() => {
    if (!supported()) return;
    setPermission(Notification.permission);
    if (Notification.permission === "default") ask();
  }, []);

  useCheckStream(({ sentAt, notifications }) => {
    router.refresh();
    if (!supported() || Notification.permission !== "granted") return;
    for (const { repository, title, body } of notifications) {
      // Every open tab shows the same Notifications; one tag per check and
      // repository shows each once.
      const shown = new Notification(title, { body, tag: `${sentAt} ${repository}` });
      shown.onclick = () => {
        window.focus();
        router.push(repositoryHref(repository, "review-inbox"));
      };
    }
  });

  if (permission !== "default") return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Turn on Notifications"
      title="Turn on Notifications"
      onClick={ask}
    >
      <BellRing />
    </Button>
  );
}
