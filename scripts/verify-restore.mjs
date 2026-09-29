import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { backup, restore } from "./database-backup.mjs";
const sourceUrl = new URL(
  process.env.DATABASE_URL ?? "postgresql://invalid/invalid",
);
if (
  !["127.0.0.1", "localhost"].includes(sourceUrl.hostname) ||
  !["/morning_pos_test", "/morning_pos_test_readiness"].includes(
    sourceUrl.pathname,
  )
)
  throw new Error(
    "Restore drill requires local morning_pos_test; never use shop data.",
  );
const source = new PrismaClient({
  datasources: { db: { url: sourceUrl.toString() } },
});
const targetUrl = new URL(sourceUrl);
const database = `morning_pos_restore_${Date.now()}`;
targetUrl.pathname = "/" + database;
const target = new PrismaClient({
  datasources: { db: { url: targetUrl.toString() } },
});
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
async function fingerprint(db) {
  const tables =
    await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
  const result = {};
  for (const { tablename } of tables) {
    const [row] = await db.$queryRawUnsafe(
      `SELECT count(*)::text AS count, md5(coalesce(string_agg(row_json, E'\\n' ORDER BY row_json), '')) AS hash FROM (SELECT row_to_json(t)::text AS row_json FROM public.${quote(tablename)} t) r`,
    );
    result[tablename] = row;
  }
  return result;
}
try {
  const started = Date.now();
  const archive = resolve(`.local/backups/restore-drill-${Date.now()}.dump`);
  process.env.BACKUP_DATABASE_URL = sourceUrl.toString();
  const before = await fingerprint(source);
  await backup(archive);
  await source.$executeRawUnsafe(`CREATE DATABASE ${quote(database)}`);
  process.env.RESTORE_DATABASE_URL = targetUrl.toString();
  process.env.RESTORE_CONFIRM_DATABASE = database;
  await restore(archive);
  const after = await fingerprint(target);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Restored table fingerprints differ. Drill failed.");
  // A second restore must refuse the populated database without touching it.
  let refused = false;
  try {
    await restore(archive);
  } catch (error) {
    refused = error.message.includes("not empty");
  }
  if (
    !refused ||
    JSON.stringify(after) !== JSON.stringify(await fingerprint(target))
  )
    throw new Error("Nonempty target guard failed.");
  const report = {
    passed: true,
    at: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    archive,
    restoredDatabase: database,
    tables: before,
    populatedTargetRefused: refused,
  };
  await writeFile(
    archive + ".verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      tables: Object.keys(before).length,
      elapsedMs: report.elapsedMs,
      report: archive + ".verification.json",
    }),
  );
} catch (error) {
  console.error(
    "Restore drill failed:",
    error.code ?? error.name,
    error.message?.startsWith("pg_")
      ? error.message
      : "See stage output; no production database was used.",
  );
  process.exitCode = 1;
} finally {
  await source.$disconnect();
  await target.$disconnect();
}
