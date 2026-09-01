import { createHash } from "node:crypto";
import path from "node:path";

function safeExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(normalized)) throw new Error("V1_PACKAGE_ATTACHMENT_EXTENSION_INVALID");
  return normalized;
}

export function privateAttachmentRelativePath(sourceId: string, extension: string): string {
  const opaqueId = createHash("sha256").update(sourceId).digest("hex").slice(0, 32);
  return path.posix.join("members", `${opaqueId}${safeExtension(extension)}`);
}

export function resolvePrivateAttachmentDestination(blobRoot: string, relativePath: string): string {
  if (!relativePath || path.posix.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error("V1_PACKAGE_ATTACHMENT_TARGET_PATH_INVALID");
  }
  const root = path.resolve(blobRoot);
  const destination = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!destination.startsWith(prefix)) throw new Error("V1_PACKAGE_ATTACHMENT_TARGET_PATH_INVALID");
  return destination;
}
