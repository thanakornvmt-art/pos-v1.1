import { z } from "zod";
import { localDb } from "./db";
let running = false;
const resultSchema = z.object({
  clientUuid: z.string(),
  id: z.string(),
  status: z.string(),
});
export async function syncPending() {
  if (running) return;
  running = true;
  try {
    for (const local of await localDb.orders
      .where("state")
      .anyOf("pending", "error")
      .toArray()) {
      try {
        const response = await fetch("/api/sync/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: local.order, permit: local.permit }),
          signal: AbortSignal.timeout(15000),
        });
        const data: unknown = await response.json();
        if (!response.ok) {
          const error = z.object({ error: z.string() }).safeParse(data);
          await localDb.orders.update(local.id, {
            state: "error",
            error: error.success ? error.data.error : "ส่งบิลไม่สำเร็จ",
          });
          continue;
        }
        const result = resultSchema.parse(data);
        if (result.clientUuid !== local.id)
          throw new Error("คำตอบไม่ตรงกับบิล");
        await localDb.transaction(
          "rw",
          localDb.orders,
          localDb.printJobs,
          async () => {
            await localDb.orders.update(local.id, {
              state: "synced",
              error: "",
            });
            await localDb.printJobs
              .where("orderId")
              .equals(local.id)
              .and((j) => j.state === "waiting-sync")
              .modify({ state: "ready" });
          },
        );
      } catch {
        break;
      }
    }
    for (const audit of await localDb.audits
      .where("state")
      .equals("pending")
      .toArray()) {
      try {
        const response = await fetch("/api/sync/audits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(audit),
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok)
          await localDb.audits.update(audit.id, { state: "synced" });
        else break;
      } catch {
        break;
      }
    }
  } finally {
    running = false;
  }
}
