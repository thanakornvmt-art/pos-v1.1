import { printerSettingsSchema, type PrinterSettings } from "@/domain/printing";

export interface PrintCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse(data: Uint8Array<ArrayBuffer>): Promise<void>;
  writeValueWithoutResponse(data: Uint8Array<ArrayBuffer>): Promise<void>;
}
interface PrintDevice extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{
      getPrimaryService(uuid: string): Promise<{
        getCharacteristic(uuid: string): Promise<PrintCharacteristic>;
      }>;
    }>;
    disconnect(): void;
  };
}
interface BluetoothApi {
  requestDevice(options: {
    filters: { services: string[] }[];
    optionalServices: string[];
  }): Promise<PrintDevice>;
}
function bluetooth(): BluetoothApi | undefined {
  return (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
}
export function supportsBluetooth() {
  return (
    typeof navigator !== "undefined" &&
    window.isSecureContext &&
    Boolean(bluetooth())
  );
}

async function writeWithTimeout(
  write: () => Promise<void>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "เครื่องพิมพ์ไม่ตอบรับเกิน 10 วินาที หยุดส่งแล้ว ตรวจใบที่ออกก่อนเชื่อมต่อและพิมพ์ซ้ำ",
          ),
        ),
      10_000,
    );
    aborted = () =>
      reject(
        signal?.reason ?? new Error("หยุดส่งพิมพ์แล้ว ตรวจใบที่ออกก่อนสั่งซ้ำ"),
      );
    signal?.addEventListener("abort", aborted, { once: true });
  });
  try {
    await Promise.race([write(), interrupted]);
  } finally {
    clearTimeout(timer);
    if (aborted) signal?.removeEventListener("abort", aborted);
  }
}

export async function writeChunks(
  characteristic: PrintCharacteristic,
  bytes: Uint8Array,
  settings: PrinterSettings,
  connected: () => boolean,
  progress: (percent: number) => void = () => {},
  signal?: AbortSignal,
) {
  const config = printerSettingsSchema.parse(settings);
  // Await acknowledged writes instead of adding a fixed sleep. Unacknowledged
  // BLE writes still need pacing to avoid flooding the printer receive buffer.
  const delayMs = characteristic.properties.write
    ? config.delayMs
    : Math.max(5, config.delayMs);
  for (let offset = 0; offset < bytes.length; offset += config.chunkSize) {
    signal?.throwIfAborted();
    if (!connected())
      throw new Error("บลูทูธหลุดระหว่างพิมพ์ ตรวจใบที่ออกก่อนสั่งซ้ำ");
    const chunk = new Uint8Array(
      bytes.slice(offset, offset + config.chunkSize),
    );
    if (characteristic.properties.write)
      await writeWithTimeout(
        () => characteristic.writeValueWithResponse(chunk),
        signal,
      );
    else if (characteristic.properties.writeWithoutResponse)
      await writeWithTimeout(
        () => characteristic.writeValueWithoutResponse(chunk),
        signal,
      );
    else throw new Error("เครื่องนี้ไม่มีช่องรับข้อมูลพิมพ์ที่รองรับ");
    progress(
      Math.min(100, Math.floor(((offset + chunk.length) * 100) / bytes.length)),
    );
    if (delayMs > 0 && offset + chunk.length < bytes.length)
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
}

export class BluetoothPrinter {
  private device?: PrintDevice;
  private characteristic?: PrintCharacteristic;
  private settings = printerSettingsSchema.parse({});
  private busy = false;
  private connecting = false;
  private activePrint?: AbortController;
  constructor(private readonly onStatus: (name: string | null) => void) {}
  private disconnected = () => {
    this.activePrint?.abort(
      new Error("บลูทูธหลุดระหว่างพิมพ์ ตรวจใบที่ออกก่อนสั่งซ้ำ"),
    );
    this.characteristic = undefined;
    this.onStatus(null);
  };
  get connected() {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
  }
  get rasterMode() {
    return this.settings.rasterMode;
  }
  async connect(settings: PrinterSettings) {
    if (this.busy || this.connecting)
      throw new Error("กำลังทำงานกับเครื่องพิมพ์");
    if (!supportsBluetooth())
      throw new Error(
        "เปิดเว็บด้วย Chrome บน Android เพื่อเชื่อมต่อบลูทูธ หรือใช้หน้าต่างพิมพ์ของระบบ",
      );
    this.settings = printerSettingsSchema.parse(settings);
    this.disconnect();
    this.connecting = true;
    try {
      // Keep requestDevice directly in the click chain; it requires user activation.
      const device = await bluetooth()!.requestDevice({
        filters: [{ services: [this.settings.service] }],
        optionalServices: [this.settings.service],
      });
      this.device = device;
      device.addEventListener("gattserverdisconnected", this.disconnected);
      const server = await device.gatt?.connect();
      if (!server) throw new Error("เครื่องนี้ไม่รองรับการเชื่อมต่อ BLE");
      const service = await server.getPrimaryService(this.settings.service);
      const characteristic = await service.getCharacteristic(
        this.settings.characteristic,
      );
      if (
        !characteristic.properties.write &&
        !characteristic.properties.writeWithoutResponse
      )
        throw new Error("เครื่องนี้ไม่รองรับช่องส่งข้อมูลที่เลือก");
      this.characteristic = characteristic;
      this.onStatus(device.name || "เครื่องพิมพ์ BLE");
    } catch (error) {
      this.disconnect();
      if (error instanceof Error && error.name === "NotFoundError")
        throw new Error(
          "ยังไม่ได้เลือกเครื่อง หรือไม่พบเครื่อง BLE ที่ตรงกับการตั้งค่า",
        );
      throw error;
    } finally {
      this.connecting = false;
    }
  }
  disconnect() {
    this.activePrint?.abort(
      new Error("หยุดส่งพิมพ์แล้ว ตรวจใบที่ออกก่อนสั่งซ้ำ"),
    );
    this.device?.removeEventListener(
      "gattserverdisconnected",
      this.disconnected,
    );
    this.device?.gatt?.disconnect();
    this.device = undefined;
    this.disconnected();
  }
  async print(bytes: Uint8Array, progress?: (percent: number) => void) {
    if (this.busy) throw new Error("กำลังส่งงานพิมพ์ กรุณารอให้เสร็จ");
    if (!this.connected || !this.characteristic)
      throw new Error("เชื่อมต่อเครื่องพิมพ์ก่อน");
    this.busy = true;
    const controller = new AbortController();
    this.activePrint = controller;
    const started = performance.now();
    let sentPercent = 0;
    try {
      await writeChunks(
        this.characteristic,
        bytes,
        this.settings,
        () => this.connected,
        (percent) => {
          sentPercent = percent;
          progress?.(percent);
        },
        controller.signal,
      );
      return {
        bytes: bytes.length,
        elapsedMs: Math.round(performance.now() - started),
        chunkSize: this.settings.chunkSize,
        delayMs: this.characteristic.properties.write
          ? this.settings.delayMs
          : Math.max(5, this.settings.delayMs),
        rasterMode: this.settings.rasterMode,
        writeMode: this.characteristic.properties.write
          ? "with-response"
          : "without-response",
      };
    } catch (error) {
      // A timed-out write may still be pending in the Bluetooth stack. Tear
      // down the connection before releasing the queue; never retry bytes.
      this.disconnect();
      const reason =
        error instanceof Error ? error.message : "ส่งพิมพ์ไม่สำเร็จ";
      throw new Error(
        `${reason} (ส่งได้ ${sentPercent}% ของ ${bytes.length} ไบต์ ใน ${((performance.now() - started) / 1000).toFixed(1)} วินาที)`,
      );
    } finally {
      this.activePrint = undefined;
      this.busy = false;
    }
  }
}
