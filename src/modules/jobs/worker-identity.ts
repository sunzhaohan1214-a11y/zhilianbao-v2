import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { writeLog } from "@/lib/logging/logger";
import type { WorkerLogger } from "./job-runner";

export function createWorkerId(): string {
  return `${hostname().slice(0, 40)}:${process.pid}:${randomBytes(4).toString("hex")}`.slice(0, 100);
}

export const jsonWorkerLogger: WorkerLogger = (entry) => {
  writeLog(entry.result === "failed" || entry.result === "shutdown_timeout" ? "error" : "info", {
    ...entry,
    module: "worker",
    result: String(entry.result ?? "unknown"),
  });
};
