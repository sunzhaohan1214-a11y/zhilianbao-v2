import { readdir } from "node:fs/promises";
import { join } from "node:path";

async function count(path) {
  let total = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) total += entry.isDirectory() ? await count(join(path, entry.name)) : /\.test\.(?:ts|tsx)$|\.spec\.ts$/.test(entry.name) ? 1 : 0;
  return total;
}
const evidence = { unit: await count("tests/unit"), integration: await count("tests/integration"), database: await count("tests/database"), e2e: await count("tests/e2e"), security: await count("tests/security"), timestamp: new Date().toISOString() };
console.log(JSON.stringify(evidence, null, 2));
