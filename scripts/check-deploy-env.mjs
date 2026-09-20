import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) {
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

const required = ["DATABASE_URL", "DIRECT_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET"];
const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const url = process.env.NEXTAUTH_URL ?? "";
const secret = process.env.NEXTAUTH_SECRET ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const directUrl = process.env.DIRECT_URL ?? "";
const errors = [];

if (!url.startsWith("https://")) {
  errors.push("NEXTAUTH_URL must be the public https:// URL of the deployed app.");
}

if (secret.length < 32) {
  errors.push("NEXTAUTH_SECRET must be at least 32 characters.");
}

if (/localhost|127\.0\.0\.1/.test(databaseUrl + directUrl)) {
  errors.push("DATABASE_URL and DIRECT_URL must point to the online PostgreSQL database, not localhost.");
}

if (databaseUrl === directUrl) {
  console.warn("DATABASE_URL and DIRECT_URL are the same. This is acceptable for a small demo, but a pooled runtime URL plus direct migration URL is better on serverless hosting.");
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log("Deployment environment looks ready.");
