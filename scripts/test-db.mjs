import { loadEnvFile } from "node:process";
import { PrismaClient } from "@prisma/client";
loadEnvFile(".env");
const db = new PrismaClient();
const rows =
  await db.$queryRaw`SELECT datname FROM pg_database WHERE datname = 'morning_pos_test'`;
if (!rows.length)
  await db.$executeRawUnsafe("CREATE DATABASE morning_pos_test");
await db.$disconnect();
console.log("Isolated integration test database ready");
