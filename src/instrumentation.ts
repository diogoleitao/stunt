// Runs once when the server starts. Checks run in the server, so they go on
// while no browser tab is open.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startChecking } = await import("./app/app-stunt.ts");
  await startChecking();
}
