import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { rasterCommand } from "@/lib/printing/raster";
import {
  writeChunks,
  type PrintCharacteristic,
} from "@/lib/printing/bluetooth";
import {
  receiptSettingsSchema,
  printerSettingsSchema,
} from "@/domain/printing";
import { localDb, type PrintJob } from "@/lib/offline/db";
import { sendPrintJob, confirmPrinted } from "@/lib/printing/queue";
import { boot } from "../fixtures";

const job: PrintJob = {
  id: "print-test",
  orderId: "00000000-0000-4000-8000-000000000004",
  kind: "CUSTOMER",
  state: "ready",
  receipt: {
    shopName: "ร้านทดสอบ",
    queueNo: "1",
    orderNo: "TEST-1",
    channel: "TAKEAWAY",
    createdAt: new Date().toISOString(),
    lines: [],
    subtotal: 0,
    discount: 0,
    tax: 0,
    total: 0,
    tendered: 0,
    change: 0,
    method: "CASH",
  },
};
beforeEach(async () => {
  await localDb.printJobs.clear();
  await localDb.audits.clear();
  let held = false;
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        if (held) return callback(null);
        held = true;
        try {
          await callback({});
        } finally {
          held = false;
        }
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("receipt output", () => {
  it("packs black pixels MSB-first, leaves transparent pixels white, and validates size", () => {
    const pixels = new Uint8ClampedArray(8 * 4).fill(255);
    pixels.set([0, 0, 0, 255], 0);
    pixels.set([0, 0, 0, 255], 28);
    pixels.set([0, 0, 0, 0], 4);
    expect([...rasterCommand(pixels, 8, 1)]).toEqual([
      29, 118, 48, 0, 1, 0, 1, 0, 129,
    ]);
    expect(() => rasterCommand(pixels, 7, 1)).toThrow();
  });
  it("validates receipt and Bluetooth inputs", () => {
    expect(receiptSettingsSchema.parse({}).paperWidth).toBe("80");
    expect(receiptSettingsSchema.safeParse({ paperWidth: "90" }).success).toBe(
      false,
    );
    expect(
      receiptSettingsSchema.safeParse({ footer: "a".repeat(301) }).success,
    ).toBe(false);
    expect(printerSettingsSchema.safeParse({ service: "bad" }).success).toBe(
      false,
    );
    expect(printerSettingsSchema.safeParse({ chunkSize: 0 }).success).toBe(
      false,
    );
  });
  it("writes ordered bounded chunks, prefers acknowledged writes", async () => {
    const withResponse = vi
      .fn<PrintCharacteristic["writeValueWithResponse"]>()
      .mockResolvedValue(undefined);
    const withoutResponse = vi.fn().mockResolvedValue(undefined);
    const characteristic: PrintCharacteristic = {
      properties: { write: true, writeWithoutResponse: true },
      writeValueWithResponse: withResponse,
      writeValueWithoutResponse: withoutResponse,
    };
    const bytes = Uint8Array.from({ length: 45 }, (_, i) => i);
    await writeChunks(
      characteristic,
      bytes,
      printerSettingsSchema.parse({ delayMs: 5 }),
      () => true,
    );
    expect(
      withResponse.mock.calls.map(([part]: [Uint8Array]) => [...part]),
    ).toEqual([
      [...bytes.slice(0, 20)],
      [...bytes.slice(20, 40)],
      [...bytes.slice(40)],
    ]);
    expect(withoutResponse).not.toHaveBeenCalled();
  });
  it("stops on disconnect instead of silently resuming a partial receipt", async () => {
    let connected = true;
    const write = vi.fn(async () => {
      connected = false;
    });
    const characteristic: PrintCharacteristic = {
      properties: { write: false, writeWithoutResponse: true },
      writeValueWithResponse: vi.fn(),
      writeValueWithoutResponse: write,
    };
    await expect(
      writeChunks(
        characteristic,
        new Uint8Array(40),
        printerSettingsSchema.parse({ delayMs: 5 }),
        () => connected,
      ),
    ).rejects.toThrow("หลุด");
    expect(write).toHaveBeenCalledTimes(1);
  });
});
describe("durable print queue", () => {
  it("rejects unsynced jobs and keeps failed/partial sends for explicit retry", async () => {
    await localDb.printJobs.put({ ...job, state: "waiting-sync" });
    const send = vi.fn(async () => {
      throw new Error("กระดาษออกครึ่งใบ");
    });
    await expect(sendPrintJob(job.id, send)).rejects.toThrow("พร้อม");
    expect(send).not.toHaveBeenCalled();
    await localDb.printJobs.update(job.id, { state: "ready" });
    await expect(sendPrintJob(job.id, send)).rejects.toThrow("ครึ่งใบ");
    expect((await localDb.printJobs.get(job.id))?.lastAttempt?.state).toBe(
      "failed",
    );
    await expect(sendPrintJob(job.id, send)).rejects.toThrow("เคยส่ง");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("marks as sent, never printed until confirmed, and confirms atomically once", async () => {
    await localDb.printJobs.add(job);
    await sendPrintJob(job.id, async () => {});
    expect((await localDb.printJobs.get(job.id))?.state).toBe("ready");
    await confirmPrinted(job.id, boot);
    expect((await localDb.printJobs.get(job.id))?.state).toBe("printed");
    expect(await localDb.audits.count()).toBe(1);
    await expect(confirmPrinted(job.id, boot)).rejects.toThrow();
    expect(await localDb.audits.count()).toBe(1);
  });
  it("blocks parallel sends and confirmation while another tab sends", async () => {
    await localDb.printJobs.add(job);
    const other = { ...job, id: "other" };
    await localDb.printJobs.add(other);
    await sendPrintJob(job.id, async () => {
      await expect(sendPrintJob(other.id, async () => {})).rejects.toThrow(
        "อีกหน้าต่าง",
      );
      await expect(confirmPrinted(job.id, boot)).rejects.toThrow("อีกหน้าต่าง");
    });
    expect(
      (await localDb.printJobs.get(other.id))?.lastAttempt,
    ).toBeUndefined();
  });
});
