import { createHash } from "node:crypto";
import type { ImportType } from "@/generated/prisma/client";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

export function rowFingerprint(importType: ImportType, mappingVersion: number, normalized: Record<string, string>): string {
  return createHash("sha256").update(JSON.stringify(stable({ importType, mappingVersion, normalized }))).digest("hex");
}
