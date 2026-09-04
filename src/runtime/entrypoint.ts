import http from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { assertZeroExtraCostPolicy } from "./zero-extra-cost-policy";

type RuntimeProcess = "web" | "worker" | "attachment-scan";

function runtimeProcess(environment: NodeJS.ProcessEnv = process.env): RuntimeProcess {
  const selected = environment.ZLB_PROCESS?.trim().toLowerCase() || "web";
  if (!["web", "worker", "attachment-scan"].includes(selected)) throw new Error("RUNTIME_PROCESS_INVALID");
  return selected as RuntimeProcess;
}

function startChild(script: string): ChildProcess {
  return spawn(process.execPath, [script], { env: process.env, stdio: "inherit" });
}

function superviseLongRunning(script: string, withProbe: boolean): void {
  const child = startChild(script);
  let stopping = false;
  const probe = withProbe ? http.createServer((request, response) => {
    const healthy = child.exitCode === null && !child.killed;
    const status = request.url === "/health" || request.url === "/ready" ? (healthy ? 200 : 503) : 404;
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: status === 200 ? "ok" : "unavailable" }));
  }) : null;
  if (probe) probe.listen(Number(process.env.PORT ?? "3000"), "0.0.0.0");

  const stop = () => {
    if (stopping) return;
    stopping = true;
    child.kill("SIGTERM");
    probe?.close();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  child.once("exit", (code, signal) => {
    probe?.close();
    if (!stopping && code !== 0) process.exitCode = code ?? (signal ? 1 : 0);
    else process.exitCode = code ?? 0;
  });
}

async function main(): Promise<void> {
  assertZeroExtraCostPolicy();
  const selected = runtimeProcess();
  if (selected === "web") superviseLongRunning("server.js", false);
  else if (selected === "worker") superviseLongRunning("worker-dist/main.js", true);
  else superviseLongRunning("worker-dist/attachment-scan-daemon.js", true);
}

void main().catch(() => {
  console.error("RUNTIME_BOOTSTRAP_FAILED");
  process.exitCode = 1;
});
