import type { Catalog, Bootstrap, CartLine } from "../src/domain/schema";
import { channels } from "../src/domain/schema";
export const catalog: Catalog = {
  settings: {
    shopName: "ร้านทดสอบ",
    taxBps: 0,
    offlineHours: 12,
    syncGraceDays: 7,
    promptpayId: null,
    qrExpirySeconds: 300,
  },
  fees: channels.map((channel) => ({
    channel,
    feeBps: channel === "GRAB" ? 3000 : 0,
  })),
  categories: [{ id: "cat", name: "โจ๊ก", color: "#fff" }],
  menus: [
    {
      id: "m1",
      name: "โจ๊กหมู",
      sku: "P01",
      categoryId: "cat",
      imageUrl: "/menu/porridge.svg",
      prices: channels.map((channel) => ({ channel, price: 4500 })),
      groups: [
        {
          id: "eggs",
          name: "ไข่",
          minSelect: 0,
          maxSelect: 1,
          isRequired: false,
          items: [
            {
              id: "egg",
              name: "ไข่ไก่",
              priceDelta: 1000,
              ingredientId: "egg",
              qtyDelta: "1",
            },
          ],
        },
      ],
      ingredients: [{ ingredientId: "rice", qty: "100" }],
      packaging: [{ channel: "TAKEAWAY", ingredientId: "bowl", qty: "1" }],
    },
  ],
};
export const boot: Bootstrap = {
  catalog,
  catalogId: "a".repeat(64),
  permit: "test-permit",
  expiresAt: Date.now() + 3600000,
  user: { id: "owner", name: "เจ้าของร้าน", role: "OWNER" },
  device: { id: "00000000-0000-4000-8000-000000000001", prefix: "DEVICEONE" },
};
export const line: CartLine = {
  id: "00000000-0000-4000-8000-000000000002",
  menuItemId: "m1",
  qty: 1,
  optionIds: [],
  note: "",
};
