import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { migrationResolutionFileSchema } from "./source-contract";
import { MigrationError } from "./errors";
import type { MigrationResolution } from "./types";

export type LoadedMigrationResolutions = {
  version: string;
  sha256: string;
  resolutions: ReadonlyMap<string, MigrationResolution>;
  sourcePath: string;
};

export function resolutionKey(sourceEntity: string, sourceId: string): string {
  return `${sourceEntity}:${sourceId}`;
}

export async function loadMigrationResolutions(
  snapshotRoot: string,
  explicitPath?: string,
): Promise<LoadedMigrationResolutions> {
  const sourcePath = path.resolve(explicitPath ?? path.join(snapshotRoot, "migration-resolutions.json"));
  let body: Buffer;
  try {
    body = await readFile(sourcePath);
  } catch {
    throw new MigrationError("MIGRATION_RESOLUTION_FILE_INVALID", "迁移 resolution 文件不存在或不可读");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch {
    throw new MigrationError("MIGRATION_RESOLUTION_FILE_INVALID", "迁移 resolution 文件不是合法 JSON");
  }
  const parsed = migrationResolutionFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new MigrationError("MIGRATION_RESOLUTION_FILE_INVALID", "迁移 resolution 文件未通过严格校验");
  }
  const resolutions = new Map<string, MigrationResolution>();
  for (const resolution of parsed.data.resolutions) {
    const key = resolutionKey(resolution.sourceEntity, resolution.sourceId);
    if (resolutions.has(key)) {
      throw new MigrationError("MIGRATION_RESOLUTION_DUPLICATED", "同一源记录存在重复 resolution");
    }
    if (resolution.action === "LINK" && (!resolution.targetEntity || !resolution.targetId)) {
      throw new MigrationError("MIGRATION_RESOLUTION_INVALID", "LINK resolution 必须包含 targetEntity 与 targetId");
    }
    if (resolution.action !== "LINK" && resolution.targetId) {
      throw new MigrationError("MIGRATION_RESOLUTION_INVALID", "只有 LINK resolution 可以指定 targetId");
    }
    resolutions.set(key, resolution);
  }
  return {
    version: parsed.data.version,
    sha256: createHash("sha256").update(body).digest("hex"),
    resolutions,
    sourcePath,
  };
}
