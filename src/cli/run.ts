import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { openServerRecord, type ServerRecord } from "../data/server-record.ts";

const STOP_TIMEOUT_MS = 10_000;

export type CliDeps = {
  dataDir: string;
  url: string;
  // What runs the server; it must listen on `url`.
  server: { command: string; args: string[]; cwd: string };
  // How long `stunt start` waits for the server to answer before stopping it.
  startTimeoutMs: number;
  openBrowser: (url: string) => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

type ServerRecordFile = ReturnType<typeof openServerRecord>;

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [command] = argv;
  if (command === "start") return runStart(deps);
  if (command === "stop") return runStop(deps);
  deps.stderr("usage: stunt start | stunt stop\n");
  return 2;
}

async function runStart(deps: CliDeps): Promise<number> {
  const record = openServerRecord(deps.dataDir);
  const live = await liveServer(record);
  if (live !== undefined) {
    deps.stdout(`stunt running at ${live.url}\n`);
    deps.openBrowser(live.url);
    return 0;
  }

  // Otherwise the new server would fail to listen while `url` still answered.
  if (await isAnswering(deps.url)) {
    deps.stderr(`stunt: ${deps.url} is already in use\n`);
    return 1;
  }
  const server = await spawnServer(deps);
  const outcome = await waitUntilAnswering(deps, server);
  if (outcome === "exited") {
    deps.stderr(`stunt: the server exited before it answered; see ${serverLog(deps.dataDir)}\n`);
    return 1;
  }
  if (outcome === "timed out") {
    await stopProcessGroup(server.pid!);
    deps.stderr(
      `stunt: the server did not answer on ${deps.url} within ${deps.startTimeoutMs / 1000} seconds; see ${serverLog(deps.dataDir)}\n`,
    );
    return 1;
  }
  await record.save({ pid: server.pid!, url: deps.url });
  deps.stdout(`stunt running at ${deps.url}\n`);
  deps.openBrowser(deps.url);
  return 0;
}

async function runStop(deps: CliDeps): Promise<number> {
  const record = openServerRecord(deps.dataDir);
  const live = await liveServer(record);
  const stopped = live !== undefined && (await stopProcessGroup(live.pid));
  await record.clear();
  deps.stdout(stopped ? "stunt stopped\n" : "stunt is not running\n");
  return 0;
}

// The recorded server, when its process is there and its URL answers. A pid
// alone is not enough: once the server is gone, the system can give its pid to
// another process.
async function liveServer(record: ServerRecordFile): Promise<ServerRecord | undefined> {
  const recorded = await record.load();
  if (recorded === undefined || !isAlive(recorded.pid)) return undefined;
  return (await isAnswering(recorded.url)) ? recorded : undefined;
}

// Asks the server's process group to stop, and kills it if it is still there
// after STOP_TIMEOUT_MS. Gives false when there is no such process group.
async function stopProcessGroup(pid: number): Promise<boolean> {
  if (!signalGroup(pid, "SIGTERM")) return false;
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  while (isAlive(pid)) {
    if (Date.now() > deadline) {
      signalGroup(pid, "SIGKILL");
      break;
    }
    await sleep(100);
  }
  return true;
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Starts the server in its own process group, detached from this one, with
// its output going to server.log in the data directory.
async function spawnServer({ dataDir, server }: CliDeps): Promise<ChildProcess> {
  await mkdir(dataDir, { recursive: true });
  const log = await open(serverLog(dataDir), "a");
  try {
    const child = spawn(server.command, server.args, {
      cwd: server.cwd,
      detached: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.unref();
    return child;
  } finally {
    await log.close();
  }
}

function serverLog(dataDir: string): string {
  return path.join(dataDir, "server.log");
}

// EPERM means the process exists but belongs to another user.
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

// Waits until `url` answers, the server exits, or startTimeoutMs passes. The
// server sits in its own process group, so Ctrl-C does not reach it: it is
// stopped here instead of being left running with no record.
async function waitUntilAnswering(
  { url, startTimeoutMs }: CliDeps,
  server: ChildProcess,
): Promise<"answering" | "exited" | "timed out"> {
  const interrupt = () => {
    signalGroup(server.pid!, "SIGTERM");
    process.exit(130);
  };
  process.once("SIGINT", interrupt);
  try {
    const deadline = Date.now() + startTimeoutMs;
    while (server.exitCode === null && server.signalCode === null) {
      if (await isAnswering(url)) return "answering";
      if (Date.now() > deadline) return "timed out";
      await sleep(100);
    }
    return "exited";
  } finally {
    process.off("SIGINT", interrupt);
  }
}

async function isAnswering(url: string): Promise<boolean> {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}
