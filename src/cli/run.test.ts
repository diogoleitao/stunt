import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerRecord } from "../data/server-record.ts";
import { runCli } from "./run.ts";

// Stands in for the Next.js server: answers every request on the port it is
// given, on 127.0.0.1.
const TINY_SERVER = `
require("node:http")
  .createServer((req, res) => res.end("ok"))
  .listen(Number(process.argv[1]), "127.0.0.1");
`;

let dir: string;
let url: string;
let port: number;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stunt-cli-"));
  port = await freePort();
  url = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  const record = await serverRecord();
  if (record !== undefined && isAlive(record.pid)) process.kill(record.pid, "SIGKILL");
  await rm(dir, { recursive: true, force: true });
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function dataDir() {
  return path.join(dir, "data");
}

async function cli(
  argv: string[],
  serverArgs = ["-e", TINY_SERVER, String(port)],
  startTimeoutMs = 10_000,
) {
  let stdout = "";
  let stderr = "";
  const opened: string[] = [];
  const code = await runCli(argv, {
    dataDir: dataDir(),
    url,
    server: { command: process.execPath, args: serverArgs, cwd: dir },
    startTimeoutMs,
    openBrowser: (target) => void opened.push(target),
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  return { code, stdout, stderr, opened };
}

async function serverRecord(): Promise<ServerRecord | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dataDir(), "server.json"), "utf8"));
  } catch {
    return undefined;
  }
}

async function writeServerRecord(record: ServerRecord) {
  await mkdir(dataDir(), { recursive: true });
  await writeFile(path.join(dataDir(), "server.json"), JSON.stringify(record));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isAnswering(target: string): Promise<boolean> {
  try {
    await fetch(target);
    return true;
  } catch {
    return false;
  }
}

// A live process that is not a stunt server, standing in for one that was
// given the recorded server's pid after it exited.
async function withUnrelatedProcess(test: (pid: number) => Promise<void>) {
  const unrelated = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    await test(unrelated.pid!);
  } finally {
    unrelated.kill("SIGKILL");
  }
}

describe("stunt start", () => {
  it("starts the server in the background, records it, prints the URL, and opens the browser", async () => {
    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `stunt running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    const record = await serverRecord();
    expect(record).toEqual({ pid: expect.any(Number), url });
    expect(isAlive(record!.pid)).toBe(true);
    expect(await isAnswering(url)).toBe(true);
  });

  it("only opens the browser when the recorded server is running", async () => {
    await cli(["start"]);
    const first = await serverRecord();

    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `stunt running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    expect(await serverRecord()).toEqual(first);
    expect(isAlive(first!.pid)).toBe(true);
  });

  it("starts a new server when the recorded one is gone", async () => {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeServerRecord({ pid: gone, url });

    const result = await cli(["start"]);

    expect(result).toEqual({
      code: 0,
      stdout: `stunt running at ${url}\n`,
      stderr: "",
      opened: [url],
    });
    const record = await serverRecord();
    expect(record).toEqual({ pid: expect.any(Number), url });
    expect(record!.pid).not.toBe(gone);
    expect(isAlive(record!.pid)).toBe(true);
    expect(await isAnswering(url)).toBe(true);
  });

  it("starts a new server when the recorded pid now belongs to another process", async () => {
    await withUnrelatedProcess(async (unrelated) => {
      await writeServerRecord({ pid: unrelated, url });

      const result = await cli(["start"]);

      expect(result).toEqual({
        code: 0,
        stdout: `stunt running at ${url}\n`,
        stderr: "",
        opened: [url],
      });
      const record = await serverRecord();
      expect(record!.pid).not.toBe(unrelated);
      expect(await isAnswering(url)).toBe(true);
      expect(isAlive(unrelated)).toBe(true);
    });
  });

  it("fails, recording nothing and stopping the server, when it does not answer in time", async () => {
    const pidFile = path.join(dir, "silent.pid");
    const silent = `
      require("node:fs").writeFileSync(process.argv[1], String(process.pid));
      setInterval(() => {}, 1000);
    `;

    const result = await cli(["start"], ["-e", silent, pidFile], 500);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `stunt: the server did not answer on ${url} within 0.5 seconds; see ${path.join(dataDir(), "server.log")}\n`,
      opened: [],
    });
    expect(await serverRecord()).toBeUndefined();
    expect(isAlive(Number(await readFile(pidFile, "utf8")))).toBe(false);
  });

  it("fails, recording nothing, when the server exits before it answers", async () => {
    const result = await cli(["start"], ["-e", "process.exit(1)"]);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `stunt: the server exited before it answered; see ${path.join(dataDir(), "server.log")}\n`,
      opened: [],
    });
    expect(await serverRecord()).toBeUndefined();
  });

  it("fails, recording nothing, when something else already answers on the URL", async () => {
    const other = createHttpServer((req, res) => res.end("other"));
    await new Promise<void>((resolve) => other.listen(port, "127.0.0.1", resolve));
    try {
      const result = await cli(["start"]);

      expect(result).toEqual({
        code: 1,
        stdout: "",
        stderr: `stunt: ${url} is already in use\n`,
        opened: [],
      });
      expect(await serverRecord()).toBeUndefined();
    } finally {
      await new Promise((resolve) => other.close(resolve));
    }
  });
});

describe("stunt stop", () => {
  it("stops the recorded server and clears the record", async () => {
    await cli(["start"]);
    const { pid } = (await serverRecord())!;

    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "stunt stopped\n", stderr: "", opened: [] });
    expect(isAlive(pid)).toBe(false);
    expect(await isAnswering(url)).toBe(false);
    expect(await serverRecord()).toBeUndefined();
  });

  it("says so when no server was started", async () => {
    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "stunt is not running\n", stderr: "", opened: [] });
  });

  it("says so and clears the record when the recorded server is gone", async () => {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    await writeServerRecord({ pid: gone, url });

    const result = await cli(["stop"]);

    expect(result).toEqual({ code: 0, stdout: "stunt is not running\n", stderr: "", opened: [] });
    expect(await serverRecord()).toBeUndefined();
  });

  it("says so, leaving it running, when the recorded pid now belongs to another process", async () => {
    await withUnrelatedProcess(async (unrelated) => {
      await writeServerRecord({ pid: unrelated, url });

      const result = await cli(["stop"]);

      expect(result).toEqual({ code: 0, stdout: "stunt is not running\n", stderr: "", opened: [] });
      expect(await serverRecord()).toBeUndefined();
      expect(isAlive(unrelated)).toBe(true);
    });
  });
});
