import { PrismaClient } from "@prisma/client";
const url = new URL(
  process.env.TEST_ADMIN_DATABASE_URL ??
    "postgresql://pos:pos_local_only@127.0.0.1:54329/postgres",
);
if (!["127.0.0.1", "localhost"].includes(url.hostname))
  throw new Error("Test database creation requires localhost.");
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const rows =
  await db.$queryRaw`SELECT datname FROM pg_database WHERE datname = 'morning_pos_test'`;
if (!rows.length)
  await db.$executeRawUnsafe("CREATE DATABASE morning_pos_test");
await db.$disconnect();
console.log("Isolated integration test database ready");
