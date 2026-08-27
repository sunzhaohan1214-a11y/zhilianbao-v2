import type { AdministrativeAreaType } from "@/generated/prisma/client";

export const ENTERPRISE_RESPONSIBLE_AREA_TYPES = [
  "TOWNSHIP",
  "PARK",
  "HIGH_TECH_ZONE",
  "DEVELOPMENT_ZONE",
] as const satisfies readonly AdministrativeAreaType[];

export type EnterpriseFormOptionsPurpose =
  | "READ_FILTER"
  | "CREATE_APPLICATION"
  | "FORMAL_CREATE";
