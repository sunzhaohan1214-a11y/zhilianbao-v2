import { getPrismaClient } from "@/lib/db/prisma";
import { seedAuthFixtures } from "./auth-fixtures";

export default async function globalSetup() {
  await seedAuthFixtures();
  await getPrismaClient().$disconnect();
}
