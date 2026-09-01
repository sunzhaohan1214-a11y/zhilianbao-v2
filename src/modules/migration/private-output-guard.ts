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
  let current = await realpath(await existingAncestor(start));
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

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function assertNoSymlinkedOutputAncestor(outputRoot: string): Promise<void> {
  const resolved = path.resolve(outputRoot);
  const filesystemRoot = path.parse(resolved).root;
  const relative = path.relative(filesystemRoot, resolved);
  let current = filesystemRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new Error("V1_PACKAGE_OUTPUT_SYMLINK_REJECTED");
    } catch (error) {
      if (isMissingPath(error)) return;
      if (error instanceof Error && error.message === "V1_PACKAGE_OUTPUT_SYMLINK_REJECTED") throw error;
      throw new Error("V1_PACKAGE_OUTPUT_PATH_UNVERIFIED");
    }
  }
}

export async function resolveSafeMigrationOutputPath(outputRoot: string): Promise<string> {
  const resolved = path.resolve(outputRoot);
  await assertNoSymlinkedOutputAncestor(resolved);
  const ancestor = await existingAncestor(resolved);
  const ancestorReal = await realpath(ancestor);
  return path.resolve(ancestorReal, path.relative(ancestor, resolved));
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
  const resolved = await resolveSafeMigrationOutputPath(outputRoot);
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
