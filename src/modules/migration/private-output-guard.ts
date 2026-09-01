import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
    await lstat(path.join(directory, ".git"));
    return true;
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw new Error("V1_PACKAGE_OUTPUT_GIT_MARKER_UNVERIFIED");
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

async function assertOutputIgnoredByGit(worktree: string, outputRoot: string): Promise<void> {
  const relative = path.relative(worktree, outputRoot);
  try {
    await execFileAsync("git", ["check-ignore", "--quiet", "--no-index", "--", relative], { cwd: worktree });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === 1) {
      throw new Error("V1_PACKAGE_OUTPUT_GIT_IGNORE_UNVERIFIED");
    }
    throw new Error("V1_PACKAGE_OUTPUT_GIT_IGNORE_UNVERIFIED");
  }
}

export async function assertPrivateMigrationOutput(outputRoot: string): Promise<void> {
  const resolved = await resolveSafeMigrationOutputPath(outputRoot);
  const worktree = await findGitWorktreeRoot(path.dirname(resolved));
  if (!worktree) return;
  const privateRoot = path.join(worktree, ".migration-work");
  if (!within(privateRoot, resolved) || resolved === privateRoot) {
    throw new Error("V1_PACKAGE_OUTPUT_INSIDE_TRACKED_GIT_PATH");
  }
  await assertOutputIgnoredByGit(worktree, resolved);
}
