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
      getPrimaryService(
        uuid: string,
      ): Promise<{
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

export async function writeChunks(
  characteristic: PrintCharacteristic,
  bytes: Uint8Array,
  settings: PrinterSettings,
  connected: () => boolean,
  progress: (percent: number) => void = () => {},
) {
  const config = printerSettingsSchema.parse(settings);
  for (let offset = 0; offset < bytes.length; offset += config.chunkSize) {
    if (!connected())
      throw new Error("บลูทูธหลุดระหว่างพิมพ์ ตรวจใบที่ออกก่อนสั่งซ้ำ");
    const chunk = new Uint8Array(
      bytes.slice(offset, offset + config.chunkSize),
    );
    if (characteristic.properties.write)
      await characteristic.writeValueWithResponse(chunk);
    else if (characteristic.properties.writeWithoutResponse)
      await characteristic.writeValueWithoutResponse(chunk);
    else throw new Error("เครื่องนี้ไม่มีช่องรับข้อมูลพิมพ์ที่รองรับ");
    progress(
      Math.min(100, Math.floor(((offset + chunk.length) * 100) / bytes.length)),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, config.delayMs));
  }
}

export class BluetoothPrinter {
  private device?: PrintDevice;
  private characteristic?: PrintCharacteristic;
  private settings = printerSettingsSchema.parse({});
  private busy = false;
  private connecting = false;
  constructor(private readonly onStatus: (name: string | null) => void) {}
  private disconnected = () => {
    this.characteristic = undefined;
    this.onStatus(null);
  };
  get connected() {
    return Boolean(this.device?.gatt?.connected && this.characteristic);
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
    try {
      await writeChunks(
        this.characteristic,
        bytes,
        this.settings,
        () => this.connected,
        progress,
      );
    } finally {
      this.busy = false;
    }
  }
}
