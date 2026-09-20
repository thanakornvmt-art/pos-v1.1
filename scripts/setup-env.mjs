import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    `DATABASE_URL="postgresql://pos:pos_local_only@127.0.0.1:54329/morning_pos?schema=public"\nDIRECT_URL="postgresql://pos:pos_local_only@127.0.0.1:54329/morning_pos?schema=public"\nNEXTAUTH_URL="http://localhost:3000"\nNEXTAUTH_SECRET="${randomBytes(48).toString("base64url")}"\nSEED_DEMO="true"\n`,
  );
console.log("Local .env ready (existing values are preserved)");
