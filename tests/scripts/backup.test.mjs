import { test } from "node:test";
import assert from "node:assert/strict";
import { connection, restore } from "../../scripts/database-backup.mjs";
test("requires explicit PostgreSQL source and keeps credentials in child environment", () => {
  assert.throws(() => connection(undefined));
  assert.throws(() => connection("https://example.com/db"));
  const config = connection(
    "postgresql://user:fake%40password@localhost:5432/test?schema=public&sslmode=require&channel_binding=require",
  );
  assert.equal(config.identity, "localhost:5432/test");
  assert.equal(config.env.PGPASSWORD, "fake@password");
  assert.equal(config.env.PGSSLMODE, "require");
  assert.equal(config.env.PGCHANNELBINDING, "require");
  assert.equal(config.env.PGDATABASE, "test");
});
test("restore refuses missing confirmation and identical source before opening an archive", async () => {
  const previous = { ...process.env };
  try {
    process.env.RESTORE_DATABASE_URL = "postgresql://u:p@localhost/test";
    delete process.env.RESTORE_CONFIRM_DATABASE;
    await assert.rejects(
      restore("nonexistent.dump"),
      /RESTORE_CONFIRM_DATABASE/,
    );
    process.env.RESTORE_CONFIRM_DATABASE = "test";
    process.env.BACKUP_DATABASE_URL = "postgresql://u:other@localhost/test";
    await assert.rejects(restore("nonexistent.dump"), /must differ/);
  } finally {
    for (const key of [
      "RESTORE_DATABASE_URL",
      "RESTORE_CONFIRM_DATABASE",
      "BACKUP_DATABASE_URL",
    ]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
