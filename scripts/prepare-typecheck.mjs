import { lstat, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextDirectory = join(repositoryRoot, ".next");
const devDirectory = join(nextDirectory, "dev");

async function rejectSymbolicLink(path, errorCode) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(errorCode);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

await rejectSymbolicLink(nextDirectory, "NEXT_CACHE_SYMLINK_FORBIDDEN");
await rejectSymbolicLink(devDirectory, "NEXT_DEV_CACHE_SYMLINK_FORBIDDEN");
await rm(devDirectory, { recursive: true, force: true });
