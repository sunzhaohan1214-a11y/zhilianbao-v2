import type { DemandStatus } from "@/generated/prisma/client";
import type { TripStatus } from "@/modules/trip/status";

export type HomeRoleLabel = "团长" | "部长";

export type HomeHeader = {
  displayName: string;
  unreadMessageCount: number;
  roleLabels: HomeRoleLabel[];
};

export type HomeAnnouncement = {
  id: string;
  title: string;
  isImportant: boolean;
  needConfirm: boolean;
  pendingConfirm: boolean;
  publishedAt: Date | null;
};

export type HomeTeamOverview = {
  roleLabels: HomeRoleLabel[];
  pendingClaim: number;
  inProgress: number;
  stale: number;
  pendingCloseReview: number;
};

export type HomePresence = {
  total: number;
  currentCount: number;
  alumniCount: number;
  remainingCount: number;
  people: Array<{
    id: string;
    name: string;
    memberType: "CURRENT" | "ALUMNI";
  }>;
};

export type HomeTrip = {
  id: string;
  startAt: Date;
  summary: string;
  participantNames: string[];
  status: TripStatus;
};

export type HomeTodo = {
  id: string;
  type: string;
  label: string;
  module: string;
  actionUrl: string;
  priority: "HIGH" | "NORMAL";
  dueAt: Date | null;
  createdAt: Date;
};

export type HomeDemand = {
  id: string;
  businessNo: string;
  title: string;
  enterpriseName: string;
  responsibleAreaName: string;
  status: Extract<DemandStatus, "PENDING_CLAIM">;
  attentionLabel: "为你推荐" | "紧急" | null;
  recommended: boolean;
  firstPublishedAt: Date;
};

export type HomeOverview = {
  header: HomeHeader;
  announcement: HomeAnnouncement | null;
  teamOverview: HomeTeamOverview | null;
  presence: HomePresence;
  trips: HomeTrip[];
  todos: HomeTodo[];
  latestDemands: {
    items: HomeDemand[];
    remainingCount: number;
  };
};
