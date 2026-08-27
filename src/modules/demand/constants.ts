import type { DemandLeadStatus, DemandStatus } from "@/generated/prisma/client";

export const DEMAND_LEAD_ENTITY = "DEMAND_LEAD";
export const DEMAND_ENTITY = "DEMAND";
export const ORIGINAL_ATTACHMENT_RELATION = "ORIGINAL";
export const SOURCE_ATTACHMENT_RELATION = "SOURCE_REFERENCE";
export const FORMAL_ATTACHMENT_RELATION = "FORMAL_ATTACHMENT";

export const DEMAND_PRE_PUBLISH_STATUSES = new Set<DemandStatus>([
  "DRAFT",
  "PENDING_REVIEW",
  "RETURNED",
]);

export const DEMAND_PUBLISHED_STATUSES = new Set<DemandStatus>([
  "PENDING_CLAIM",
  "IN_PROGRESS",
  "PENDING_CLOSE_REVIEW",
  "COMPLETED",
  "CANCELED",
  "MERGED",
]);

export const DEMAND_LEAD_TERMINAL_STATUSES = new Set<DemandLeadStatus>([
  "MERGED",
  "CLOSED",
  "CONVERTED",
]);

export const DEMAND_LEAD_ACTIONABLE_STATUSES = new Set<DemandLeadStatus>([
  "PENDING_TOWNSHIP_VERIFY",
  "PENDING_ENTERPRISE_LINK",
  "NEED_MORE_INFO",
]);

export const PUBLIC_DEMAND_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const PUBLIC_DEMAND_IP_MAXIMUM = 20;
export const PUBLIC_DEMAND_DEVICE_MAXIMUM = 10;
export const PUBLIC_DEMAND_UPLOAD_IP_MAXIMUM = 60;
export const PUBLIC_DEMAND_UPLOAD_DEVICE_MAXIMUM = 30;
