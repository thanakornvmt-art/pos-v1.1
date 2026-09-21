import Dexie, { type EntityTable } from "dexie";
import type { ReceiptSettings } from "@/domain/printing";
import type {
  Bootstrap,
  CartLine,
  Channel,
  OrderInput,
  Discount,
} from "@/domain/schema";
export interface LocalOrder {
  id: string;
  order: OrderInput;
  permit: string;
  state: "pending" | "synced" | "error";
  error: string;
  receipt: Receipt;
}
export interface Receipt {
  settings?: ReceiptSettings;
  shopName: string;
  queueNo: string;
  orderNo: string;
  channel: string;
  createdAt: string;
  lines: {
    name: string;
    qty: number;
    options: string[];
    note: string;
    total: number;
  }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  tendered: number;
  change: number;
  method: string;
}
export interface PrintJob {
  lastAttempt?: {
    at: string;
    state: "sending" | "sent" | "failed";
    error?: string;
  };
  id: string;
  orderId: string;
  kind: "KITCHEN" | "CUSTOMER";
  state: "waiting-sync" | "ready" | "printed";
  receipt: Receipt;
  printedAt?: string;
}
export interface Draft {
  id: string;
  name: string;
  channel: Channel;
  lines: CartLine[];
  userId: string;
  deliveryId?: string;
  bootstrap?: Bootstrap;
}
export interface LocalAudit {
  id: string;
  permit: string;
  userId: string;
  deviceId: string;
  action:
    | "REMOVE_LINE"
    | "CLEAR_CART"
    | "SPLIT_BILL"
    | "MERGE_BILL"
    | "PRINT_KITCHEN"
    | "PRINT_CUSTOMER"
    | "SET_DISCOUNT";
  details?: Discount;
  entityId: string;
  before: CartLine[];
  after: CartLine[];
  createdAt: string;
  state: "pending" | "synced";
}
class PosDb extends Dexie {
  orders!: EntityTable<LocalOrder, "id">;
  printJobs!: EntityTable<PrintJob, "id">;
  drafts!: EntityTable<Draft, "id">;
  audits!: EntityTable<LocalAudit, "id">;
  meta!: EntityTable<{ key: string; value: string }, "key">;
  bootstrap!: EntityTable<{ key: string; data: Bootstrap }, "key">;
  constructor() {
    super("morning-pos-v1");
    this.version(1).stores({
      orders: "id,state",
      printJobs: "id,orderId,state",
      drafts: "id,userId",
      audits: "id,state",
      meta: "key",
      bootstrap: "key",
    });
  }
}
export const localDb = new PosDb();
export async function deviceId() {
  return localDb.transaction("rw", localDb.meta, async () => {
    const old = await localDb.meta.get("deviceId");
    if (old) return old.value;
    const value = crypto.randomUUID();
    await localDb.meta.put({ key: "deviceId", value });
    return value;
  });
}
