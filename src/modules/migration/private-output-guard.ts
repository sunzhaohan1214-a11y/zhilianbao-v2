import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

async function existingAncestor(value: string): Promise<string> {
  let current = path.resolve(value);
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

async function hasGitMarker(directory: string): Promise<boolean> {
  try {
    const stat = await lstat(path.join(directory, ".git"));
    return stat.isDirectory() || stat.isFile();
  } catch {
    return false;
  }
}

async function findGitWorktreeRoot(start: string): Promise<string | null> {
  let current = await existingAncestor(start);
  while (true) {
    if (await hasGitMarker(current)) return realpath(current);
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

function migrationWorkIsIgnored(gitignore: string): boolean {
  const rules = gitignore.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  let ignored = false;
  for (const rule of rules) {
    if (["/.migration-work", "/.migration-work/", ".migration-work", ".migration-work/"].includes(rule)) ignored = true;
    if (["!/.migration-work", "!/.migration-work/", "!.migration-work", "!.migration-work/"].includes(rule)
      || rule.startsWith("!/.migration-work/") || rule.startsWith("!.migration-work/")) ignored = false;
  }
  return ignored;
}

export async function assertPrivateMigrationOutput(outputRoot: string): Promise<void> {
  const resolved = path.resolve(outputRoot);
  const worktree = await findGitWorktreeRoot(path.dirname(resolved));
  if (!worktree) return;
  const privateRoot = path.join(worktree, ".migration-work");
  if (!within(privateRoot, resolved) || resolved === privateRoot) {
    throw new Error("V1_PACKAGE_OUTPUT_INSIDE_TRACKED_GIT_PATH");
  }
  let gitignore: string;
  try {
    gitignore = await readFile(path.join(worktree, ".gitignore"), "utf8");
  } catch {
    throw new Error("V1_PACKAGE_OUTPUT_GIT_IGNORE_UNVERIFIED");
  }
  if (!migrationWorkIsIgnored(gitignore)) throw new Error("V1_PACKAGE_OUTPUT_GIT_IGNORE_UNVERIFIED");
}
