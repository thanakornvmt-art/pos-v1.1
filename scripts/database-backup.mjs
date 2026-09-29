import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

// Credentials are passed through child environment variables, never command arguments.
export function connection(raw) {
  if (!raw)
    throw new Error(
      "Set BACKUP_DATABASE_URL or RESTORE_DATABASE_URL explicitly.",
    );
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("PostgreSQL URL required.");
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!database || database.includes("/"))
    throw new Error("Invalid database name.");
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("PG")) delete env[key];
  Object.assign(env, {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT: "15",
  });
  for (const [param, variable] of [
    ["sslmode", "PGSSLMODE"],
    ["sslrootcert", "PGSSLROOTCERT"],
    ["sslcert", "PGSSLCERT"],
    ["sslkey", "PGSSLKEY"],
    ["channel_binding", "PGCHANNELBINDING"],
    ["options", "PGOPTIONS"],
  ]) {
    if (url.searchParams.has(param))
      env[variable] = url.searchParams.get(param);
  }
  return {
    env,
    database,
    identity: `${url.hostname}:${url.port || "5432"}/${database}`,
  };
}

export function runPg(name, args, config) {
  const executable = process.env.PG_BIN
    ? join(
        process.env.PG_BIN,
        name + (process.platform === "win32" ? ".exe" : ""),
      )
    : name;
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const child = spawn(executable, args, {
      env: config.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    // Tool errors can contain database values and connection details. Keep them private.
    child.stderr.resume();
    child.on("error", () =>
      reject(
        new Error(
          `${name} unavailable. Install PostgreSQL client tools and set PG_BIN.`,
        ),
      ),
    );
    child.on("close", (code) =>
      code === 0
        ? resolvePromise(output.trim())
        : reject(
            new Error(
              `${name} failed (exit ${code}); no successful backup/restore is claimed.`,
            ),
          ),
    );
  });
}
export async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function backup(file) {
  const source = connection(process.env.BACKUP_DATABASE_URL);
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  // Reserve both names to avoid overwriting an earlier backup.
  const reservation = await open(target, "wx", 0o600);
  await reservation.close();
  const partial = target + ".partial";
  const pending = await open(partial, "wx", 0o600);
  await pending.close();
  await runPg(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges", "--file", partial],
    source,
  );
  await runPg("pg_restore", ["--list", partial], source);
  if (!(await stat(partial)).size) throw new Error("Empty backup.");
  await rename(partial, target);
  const manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    database: source.database,
    sha256: await checksum(target),
    bytes: (await stat(target)).size,
  };
  await writeFile(target + ".json", JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(`Backup complete: ${target}`);
  return manifest;
}
export async function restore(file) {
  const target = connection(process.env.RESTORE_DATABASE_URL);
  if (process.env.RESTORE_CONFIRM_DATABASE !== target.database)
    throw new Error(
      "Set RESTORE_CONFIRM_DATABASE to the exact NEW target database name.",
    );
  if (
    process.env.BACKUP_DATABASE_URL &&
    connection(process.env.BACKUP_DATABASE_URL).identity === target.identity
  )
    throw new Error("Source and restore target must differ.");
  const archive = resolve(file);
  const manifest = JSON.parse(await readFile(archive + ".json", "utf8"));
  if (
    manifest.format !== 1 ||
    manifest.sha256 !== (await checksum(archive)) ||
    manifest.bytes !== (await stat(archive)).size
  )
    throw new Error("Backup checksum/manifest mismatch.");
  const tables = await runPg(
    "psql",
    [
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND c.relkind IN ('r','p','v','m','S','f');",
    ],
    target,
  );
  if (tables !== "0")
    throw new Error(
      "Restore target is not empty. Create a new database; existing data will not be deleted.",
    );
  await runPg(
    "pg_restore",
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      target.database,
      archive,
    ],
    target,
  );
  console.log(`Restore complete into new database: ${target.database}`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [mode, file] = process.argv.slice(2);
    if (!file || !["backup", "restore"].includes(mode))
      throw new Error(
        "Usage: node scripts/database-backup.mjs backup|restore <archive.dump>",
      );
    await (mode === "backup" ? backup(file) : restore(file));
  } catch (error) {
    console.error(
      error instanceof TypeError || error instanceof SyntaxError
        ? "Invalid backup configuration or manifest."
        : error.message,
    );
    process.exitCode = 1;
  }
}
