import { lstat } from "node:fs/promises";
import path from "node:path";

async function hasGitMarker(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(path.join(directory, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function findGitWorktreeRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    if (await hasGitMarker(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function within(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(prefix);
}

export async function assertPrivateMigrationOutput(outputRoot: string): Promise<void> {
  const resolved = path.resolve(outputRoot);
  const worktree = await findGitWorktreeRoot(path.dirname(resolved));
  if (!worktree) return;
  const privateRoot = path.join(worktree, ".migration-work");
  if (!within(privateRoot, resolved)) throw new Error("V1_PACKAGE_OUTPUT_INSIDE_TRACKED_GIT_PATH");
}
