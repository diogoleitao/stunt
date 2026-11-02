import { listenToChecks } from "../app-stunt.ts";

const encoder = new TextEncoder();

// Streams every check to an open tab as a server-sent event while the tab is
// connected, so the tab only hears the checks made while it is open.
export function GET(): Response {
  let stop = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      stop = listenToChecks((update) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
        } catch {
          // The tab's stream closed without being cancelled; the other tabs
          // still hear the check.
          stop();
        }
      });
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" },
  });
}
