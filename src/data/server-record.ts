import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";

// The server `stunt start` left running in the background.
export type ServerRecord = {
  pid: number;
  url: string;
};

export function openServerRecord(dataDir: string) {
  const recordPath = path.join(dataDir, "server.json");
  return {
    async load(): Promise<ServerRecord | undefined> {
      const text = await ifExists(readFile(recordPath, "utf8"));
      return text === undefined ? undefined : (JSON.parse(text) as ServerRecord);
    },

    async save(record: ServerRecord): Promise<void> {
      await writeFileAtomically(recordPath, `${JSON.stringify(record, null, 2)}\n`);
    },

    async clear(): Promise<void> {
      await rm(recordPath, { force: true });
    },
  };
}
