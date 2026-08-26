export const applicationStatus = {
  service: "zhilianbao-v2",
  status: "ok",
} as const;

export function getReadiness() {
  return {
    service: applicationStatus.service,
    status: "ready" as const,
    checks: {
      application: "ok" as const,
      configuration: "ok" as const,
    },
    database: "not-configured" as const,
  };
}
