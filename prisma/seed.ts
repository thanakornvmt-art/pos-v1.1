import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { channels } from "../src/domain/schema";
const db = new PrismaClient();
async function main() {
  if (process.env.SEED_DEMO !== "true")
    throw new Error("กำหนด SEED_DEMO=true เพื่อยืนยันข้อมูลทดลอง");
  if (await db.settings.count()) {
    console.log("มีข้อมูลแล้ว ข้าม seed เพื่อไม่ทับข้อมูลร้าน");
    return;
  }
  const pins = await Promise.all(
    ["1234", "2345", "3456"].map((p) => hash(p, 12)),
  );
  await db.$transaction(
    async (tx) => {
      await tx.settings.create({
        data: {
          id: "store",
          shopName: "โจ๊กอรุณ • ร้านทดลอง",
          taxBps: 0,
          safetyDays: 2,
        },
      });
      await tx.channelSetting.createMany({
        data: channels.map((channel) => ({
          channel,
          feeBps: ["GRAB", "LINEMAN", "SHOPEE"].includes(channel) ? 3000 : 0,
        })),
      });
      await tx.user.createMany({
        data: [
          { id: "owner", name: "เจ้าของร้าน", role: "OWNER", pinHash: pins[0] },
          {
            id: "cashier",
            name: "แคชเชียร์",
            role: "CASHIER",
            pinHash: pins[1],
          },
          { id: "kitchen", name: "ครัว", role: "KITCHEN", pinHash: pins[2] },
        ],
      });
      await tx.category.createMany({
        data: [
          { id: "porridge", name: "โจ๊ก", sortOrder: 1, color: "#d5e8ce" },
          { id: "soup", name: "ต้มเลือดหมู", sortOrder: 2, color: "#f4d5b9" },
          { id: "sides", name: "ของทานคู่", sortOrder: 3, color: "#eddda5" },
          { id: "drinks", name: "เครื่องดื่ม", sortOrder: 4, color: "#c8e4df" },
        ],
      });
      const ingredients: [
        string,
        string,
        string,
        string,
        number,
        number,
        string,
        number,
      ][] = [
        ["rice", "ข้าวสาร", "กิโลกรัม", "กรัม", 1000, 100, "4", 20000],
        ["pork", "หมูบด", "กิโลกรัม", "กรัม", 1000, 95, "20", 10000],
        ["liver", "ตับหมู", "กิโลกรัม", "กรัม", 1000, 90, "16.66666667", 4000],
        ["blood", "เลือดหมู", "กิโลกรัม", "กรัม", 1000, 100, "5", 5000],
        ["offal", "เครื่องในหมู", "กิโลกรัม", "กรัม", 1000, 80, "22.5", 5000],
        ["egg", "ไข่ไก่", "แผง", "ฟอง", 30, 100, "400", 300],
        ["century", "ไข่เยี่ยวม้า", "แพ็ก", "ฟอง", 10, 100, "800", 100],
        ["ginger", "ขิง", "กิโลกรัม", "กรัม", 1000, 85, "7.05882353", 2000],
        ["onion", "ต้นหอม", "กิโลกรัม", "กรัม", 1000, 80, "10", 2000],
        ["season", "เครื่องปรุง", "ขวด", "มิลลิลิตร", 1000, 100, "5", 5000],
        ["bones", "กระดูกหมู", "กิโลกรัม", "กรัม", 1000, 100, "6", 5000],
        ["water", "น้ำสะอาด", "ลิตร", "มิลลิลิตร", 1000, 100, "0.1", 100000],
        ["dough", "ปาท่องโก๋", "ถุง", "ตัว", 20, 100, "200", 400],
        ["soy", "นมถั่วเหลือง", "ลัง", "ขวด", 12, 100, "700", 120],
        ["bowl", "ถ้วยพร้อมฝา", "แพ็ก", "ชุด", 50, 100, "300", 1000],
        ["bag", "ถุงพร้อมช้อน", "แพ็ก", "ชุด", 100, 100, "100", 1000],
      ];
      for (const [
        id,
        name,
        purchaseUnit,
        usageUnit,
        conversionRate,
        yieldPercent,
        avgCost,
        currentQty,
      ] of ingredients)
        await tx.ingredient.create({
          data: {
            id,
            name,
            purchaseUnit,
            usageUnit,
            conversionRate,
            yieldPercent,
            avgCost,
            currentQty,
            parLevel: currentQty,
            reorderPoint: Math.floor(currentQty / 4),
            isPerishable: !["bowl", "bag", "water", "season"].includes(id),
            shelfLifeDays: ["bowl", "bag"].includes(id) ? null : 3,
          },
        });
      await tx.subRecipe.create({
        data: {
          id: "base",
          name: "หม้อโจ๊กเบส",
          outputQty: 10000,
          outputUnit: "กรัม",
          lines: {
            create: [
              { ingredientId: "rice", qty: 1000 },
              { ingredientId: "water", qty: 9500 },
              { ingredientId: "season", qty: 100 },
            ],
          },
        },
      });
      await tx.subRecipe.create({
        data: {
          id: "broth",
          name: "น้ำซุป",
          outputQty: 10000,
          outputUnit: "มิลลิลิตร",
          lines: {
            create: [
              { ingredientId: "bones", qty: 1000 },
              { ingredientId: "water", qty: 11000 },
              { ingredientId: "season", qty: 100 },
            ],
          },
        },
      });
      const groups: {
        id: string;
        name: string;
        items: {
          id: string;
          name: string;
          priceDelta: number;
          ingredientId?: string;
          qtyDelta?: number;
        }[];
      }[] = [
        {
          id: "eggs",
          name: "เพิ่มไข่",
          items: [
            {
              id: "add-egg",
              name: "ไข่ไก่",
              priceDelta: 1000,
              ingredientId: "egg",
              qtyDelta: 1,
            },
            {
              id: "add-century",
              name: "ไข่เยี่ยวม้า",
              priceDelta: 1500,
              ingredientId: "century",
              qtyDelta: 1,
            },
          ],
        },
        {
          id: "meat",
          name: "เพิ่มเนื้อ",
          items: [
            {
              id: "add-pork",
              name: "หมูพิเศษ",
              priceDelta: 1500,
              ingredientId: "pork",
              qtyDelta: 40,
            },
            {
              id: "add-liver",
              name: "เพิ่มตับ",
              priceDelta: 1000,
              ingredientId: "liver",
              qtyDelta: 30,
            },
          ],
        },
        {
          id: "herbs",
          name: "ผักและขิง",
          items: [
            { id: "no-ginger", name: "ไม่ใส่ขิง", priceDelta: 0 },
            { id: "no-onion", name: "ไม่ใส่ต้นหอม", priceDelta: 0 },
          ],
        },
        {
          id: "taste",
          name: "รสชาติ",
          items: [
            { id: "light", name: "รสอ่อน", priceDelta: 0 },
            { id: "normal", name: "รสปกติ", priceDelta: 0 },
          ],
        },
        {
          id: "extras",
          name: "ของทานเพิ่ม",
          items: [
            {
              id: "add-dough",
              name: "ปาท่องโก๋ 1 ตัว",
              priceDelta: 500,
              ingredientId: "dough",
              qtyDelta: 1,
            },
          ],
        },
      ];
      for (const g of groups)
        await tx.optionGroup.create({
          data: {
            id: g.id,
            name: g.name,
            minSelect: 0,
            maxSelect: g.id === "taste" ? 1 : 2,
            isRequired: false,
            items: { create: g.items },
          },
        });
      const menus: [string, string, string, number, string, number][] = [
        ["P01", "โจ๊กหมู", "porridge", 4500, "pork", 60],
        ["P02", "โจ๊กหมูไข่", "porridge", 5500, "pork", 60],
        ["P03", "โจ๊กตับ", "porridge", 5000, "liver", 70],
        ["P04", "โจ๊กไข่เยี่ยวม้า", "porridge", 6000, "century", 1],
        ["S01", "ต้มเลือดหมู", "soup", 6000, "blood", 100],
        ["S02", "ต้มเลือดหมูรวม", "soup", 7000, "offal", 80],
        ["S03", "ต้มหมูล้วน", "soup", 6500, "pork", 100],
        ["X01", "ข้าวเปล่า", "sides", 1000, "rice", 70],
        ["X02", "ปาท่องโก๋ 2 ตัว", "sides", 1000, "dough", 2],
        ["X03", "ไข่ลวก", "sides", 1000, "egg", 1],
        ["D01", "นมถั่วเหลือง", "drinks", 1500, "soy", 1],
        ["D02", "น้ำดื่ม", "drinks", 1000, "water", 500],
      ];
      for (const [id, name, categoryId, price, ingredientId, qty] of menus) {
        const main = ["porridge", "soup"].includes(categoryId);
        await tx.menuItem.create({
          data: {
            id,
            sku: id,
            name,
            categoryId,
            imageUrl: `/menu/${categoryId}.svg`,
            prepSeconds: main ? 90 : 10,
            prices: {
              create: channels.map((channel) => ({
                channel,
                price: ["GRAB", "LINEMAN", "SHOPEE"].includes(channel)
                  ? price + 2000
                  : price,
              })),
            },
            optionGroups: {
              create: main ? groups.map((g) => ({ optionGroupId: g.id })) : [],
            },
            bom: {
              create: [
                {
                  ingredientId,
                  qty,
                  unit:
                    ingredients.find((i) => i[0] === ingredientId)?.[3] ??
                    "หน่วย",
                },
                ...(main
                  ? [
                      {
                        subRecipeId:
                          categoryId === "porridge" ? "base" : "broth",
                        qty: 300,
                        unit: categoryId === "porridge" ? "กรัม" : "มิลลิลิตร",
                      },
                    ]
                  : []),
                ...(id === "P02"
                  ? [{ ingredientId: "egg", qty: 1, unit: "ฟอง" }]
                  : []),
              ],
            },
            packaging: {
              create: channels
                .filter((c) => c !== "DINE_IN")
                .flatMap((channel) => [
                  { channel, ingredientId: "bag", qty: 1 },
                  ...(main ? [{ channel, ingredientId: "bowl", qty: 1 }] : []),
                ]),
            },
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: "owner",
          action: "SEED_DEMO",
          entity: "Settings",
          entityId: "store",
          beforeJson: {},
          afterJson: { demo: true },
        },
      });
    },
    { timeout: 30000 },
  );
  console.log("ข้อมูลทดลองพร้อมใช้: เจ้าของ 1234 / แคชเชียร์ 2345 / ครัว 3456");
}
main().finally(() => db.$disconnect());
