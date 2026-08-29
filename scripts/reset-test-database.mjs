import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL ?? "";
let parsed;
try { parsed = new URL(databaseUrl); } catch { throw new Error("TEST_DATABASE_URL_INVALID"); }

const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const localHost = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
if (process.env.APP_ENV !== "test" || parsed.protocol !== "mysql:" || !localHost || !/_test$/i.test(databaseName)) {
  throw new Error("TEST_DATABASE_RESET_REFUSED");
}

const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "reset", "--force"], {
  env: process.env,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
