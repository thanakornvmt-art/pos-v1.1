import { localDb, type PrintJob } from "@/lib/offline/db";
import type { Bootstrap } from "@/domain/schema";

export async function sendPrintJob(
  id: string,
  send: (job: PrintJob) => Promise<void>,
  repeatConfirmed = false,
) {
  if (!navigator.locks)
    throw new Error(
      "เบราว์เซอร์นี้ไม่รองรับการป้องกันงานพิมพ์ซ้ำ กรุณาใช้ Chrome รุ่นปัจจุบัน",
    );
  await navigator.locks.request(
    "pos-receipt-printer",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("มีงานพิมพ์กำลังส่งจากอีกหน้าต่าง กรุณารอ");
      const job = await localDb.transaction(
        "rw",
        localDb.printJobs,
        async () => {
          const current = await localDb.printJobs.get(id);
          if (!current || current.state !== "ready")
            throw new Error("บิลยังไม่พร้อมพิมพ์ หรือยืนยันพิมพ์แล้ว");
          if (current.lastAttempt && !repeatConfirmed)
            throw new Error(
              "บิลนี้เคยส่งพิมพ์แล้ว ตรวจใบที่ออกและยืนยันก่อนพิมพ์ซ้ำ",
            );
          await localDb.printJobs.update(id, {
            lastAttempt: { at: new Date().toISOString(), state: "sending" },
          });
          return current;
        },
      );
      try {
        await send(job);
        await localDb.printJobs.update(id, {
          lastAttempt: { at: new Date().toISOString(), state: "sent" },
        });
      } catch (error) {
        await localDb.printJobs.update(id, {
          lastAttempt: {
            at: new Date().toISOString(),
            state: "failed",
            error: error instanceof Error ? error.message : "ส่งพิมพ์ไม่สำเร็จ",
          },
        });
        throw error;
      }
    },
  );
}

export async function confirmPrinted(id: string, boot: Bootstrap) {
  if (Date.now() >= boot.expiresAt)
    throw new Error("เข้าสู่ระบบออนไลน์ก่อนยืนยัน");
  if (!navigator.locks) throw new Error("กรุณาใช้ Chrome รุ่นปัจจุบัน");
  await navigator.locks.request(
    "pos-receipt-printer",
    { ifAvailable: true },
    async (lock) => {
      if (!lock) throw new Error("กำลังส่งพิมพ์จากอีกหน้าต่าง กรุณารอให้เสร็จ");
      await localDb.transaction(
        "rw",
        localDb.printJobs,
        localDb.audits,
        async () => {
          const job = await localDb.printJobs.get(id);
          if (!job || job.state !== "ready")
            throw new Error("บิลยังไม่พร้อม หรือยืนยันพิมพ์แล้ว");
          await localDb.printJobs.update(id, {
            state: "printed",
            printedAt: new Date().toISOString(),
          });
          await localDb.audits.add({
            id: crypto.randomUUID(),
            permit: boot.permit,
            userId: boot.user.id,
            deviceId: boot.device.id,
            action: job.kind === "KITCHEN" ? "PRINT_KITCHEN" : "PRINT_CUSTOMER",
            entityId: job.orderId,
            before: [],
            after: [],
            createdAt: new Date().toISOString(),
            state: "pending",
          });
        },
      );
    },
  );
}
