import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { compactRasterCommands, rasterCommand } from "@/lib/printing/raster";
import {
  BluetoothPrinter,
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("receipt output", () => {
  async function connectedPrinter(
    write: PrintCharacteristic["writeValueWithResponse"],
  ) {
    const characteristic: PrintCharacteristic = {
      properties: { write: true, writeWithoutResponse: false },
      writeValueWithResponse: write,
      writeValueWithoutResponse: vi.fn(),
    };
    const device = Object.assign(new EventTarget(), {
      name: "G80 test double",
      gatt: {
        connected: true,
        connect: async () => {
          device.gatt.connected = true;
          return {
            getPrimaryService: async () => ({
              getCharacteristic: async () => characteristic,
            }),
          };
        },
        disconnect: vi.fn(() => {
          device.gatt.connected = false;
        }),
      },
    });
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      ...navigator,
      bluetooth: { requestDevice: async () => device },
    });
    const printer = new BluetoothPrinter(vi.fn());
    await printer.connect(printerSettingsSchema.parse({}));
    return { printer, device };
  }
  it("times out a stalled write, disconnects, and never sends remaining bytes after a late response", async () => {
    vi.useFakeTimers();
    let finishWrite!: () => void;
    const write = vi
      .fn<PrintCharacteristic["writeValueWithResponse"]>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const { printer, device } = await connectedPrinter(write);
    const failed = expect(printer.print(new Uint8Array(40))).rejects.toThrow(
      "10 วินาที",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(printer.connected).toBe(false);
    expect(device.gatt.disconnect).toHaveBeenCalledOnce();
    finishWrite();
    await vi.advanceTimersByTimeAsync(100);
    expect(write).toHaveBeenCalledTimes(1);
    await printer.connect(printerSettingsSchema.parse({}));
    await printer.print(new Uint8Array(20));
    expect(write).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("manual disconnect immediately releases a stuck send without retrying it", async () => {
    vi.useFakeTimers();
    const write = vi
      .fn<PrintCharacteristic["writeValueWithResponse"]>()
      .mockImplementation(() => new Promise<void>(() => {}));
    const { printer } = await connectedPrinter(write);
    const failed = expect(printer.print(new Uint8Array(40))).rejects.toThrow(
      "หยุดส่ง",
    );
    printer.disconnect();
    await failed;
    expect(write).toHaveBeenCalledOnce();
    expect(printer.connected).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  // Reconstruct the paper from ESC/POS image commands, including blank feed.
  function decodePaper(bytes: Uint8Array, width: number, height: number) {
    const paper = new Uint8Array((width / 8) * height);
    let offset = 0;
    let row = 0;
    while (offset < bytes.length) {
      expect([...bytes.subarray(offset, offset + 4)]).toEqual([29, 118, 48, 0]);
      const columns = bytes[offset + 4] + bytes[offset + 5] * 256;
      const rows = bytes[offset + 6] + bytes[offset + 7] * 256;
      expect(columns).toBeGreaterThan(0);
      expect(columns).toBeLessThanOrEqual(width / 8);
      expect(rows).toBeGreaterThan(0);
      expect(row + rows).toBeLessThanOrEqual(height);
      offset += 8;
      expect(offset + columns * rows).toBeLessThanOrEqual(bytes.length);
      for (let y = 0; y < rows; y++) {
        paper.set(
          bytes.subarray(offset, offset + columns),
          (row + y) * (width / 8),
        );
        offset += columns;
      }
      row += rows;
    }
    expect(row).toBe(height);
    return paper;
  }
  it.each([384, 576])(
    "reduces padded text data without moving any dots on %i-dot paper",
    (width) => {
      const height = 52;
      const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
      // Separate marks above/below the text exercise Thai vowel/tone placement.
      for (const [x, y] of [
        [8, 8],
        [17, 13],
        [80, 20],
        [127, 36],
        [15, 42],
      ]) {
        rgba.set([0, 0, 0, 255], (y * width + x) * 4);
      }
      const original = rasterCommand(rgba, width, height);
      const compact = compactRasterCommands(rgba, width, height);
      expect(decodePaper(compact, width, height)).toEqual(
        decodePaper(original, width, height),
      );
      expect(compact.length).toBeLessThan(original.length / 3);
    },
  );
  it.each(["blank", "solid", "edges", "transparent"])(
    "preserves %s images and never increases data size",
    (kind) => {
      const width = 576;
      const height = 256;
      const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (
            kind === "solid" ||
            kind === "transparent" ||
            (kind === "edges" && (x === 0 || x === width - 1))
          ) {
            rgba.set(
              [0, 0, 0, kind === "transparent" ? 0 : 255],
              (y * width + x) * 4,
            );
          }
        }
      }
      const original = rasterCommand(rgba, width, height);
      const compact = compactRasterCommands(rgba, width, height);
      expect(decodePaper(compact, width, height)).toEqual(
        decodePaper(original, width, height),
      );
      expect(compact.length).toBeLessThanOrEqual(original.length);
    },
  );
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
