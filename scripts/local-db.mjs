import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(".local/postgres");
mkdirSync(resolve(".local"), { recursive: true });
const pg = new EmbeddedPostgres({
  databaseDir: directory,
  user: "pos",
  password: "pos_local_only",
  port: 54329,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
});
if (!existsSync(resolve(directory, "PG_VERSION"))) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const result = await client.query(
  "SELECT 1 FROM pg_database WHERE datname='morning_pos'",
);
await client.end();
if (!result.rows.length) await pg.createDatabase("morning_pos");
console.log("Local PostgreSQL ready on 127.0.0.1:54329");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await pg.stop();
    process.exit(0);
  });
setInterval(() => {}, 30000);
