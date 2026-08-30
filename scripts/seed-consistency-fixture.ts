import { disconnectPrismaClient } from "../src/lib/db/prisma.ts";
import { seedAuthFixtures } from "../tests/e2e/auth-fixtures.ts";

if (!/test/i.test(process.env.DATABASE_URL ?? "")) throw new Error("CONSISTENCY_FIXTURE_TEST_DATABASE_REQUIRED");
await seedAuthFixtures();
await disconnectPrismaClient();
console.log(JSON.stringify({ status: "PASS", fixture: "e2e-authorized-domain-baseline" }));
