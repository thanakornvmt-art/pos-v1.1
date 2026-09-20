import Decimal from "decimal.js";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { dateRangeSchema, dateBounds } from "@/domain/reports";
import { moneySchema } from "@/domain/schema";
import { roundMoney } from "@/domain/pricing";
function day(date: Date) {
  return new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export async function GET(req: Request) {
  try {
    await authorized(true);
    const range = dateRangeSchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const bounds = dateBounds(range.from, range.to);
    const [orders, movements, closes] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: bounds, status: "PAID" },
        include: { lines: true },
      }),
      prisma.stockMovement.findMany({
        where: { createdAt: bounds, type: { in: ["WASTE", "COUNT"] } },
        include: { ingredient: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.cashClose.findMany({
        where: { businessDate: { gte: range.from, lte: range.to } },
        orderBy: { businessDate: "asc" },
      }),
    ]);
    const summary = {
      bills: orders.length,
      sales: 0,
      net: 0,
      food: 0,
      packaging: 0,
      profit: 0,
      foodCostBps: null as number | null,
    };
    const daily = new Map<
      string,
      { date: string; bills: number; sales: number; profit: number }
    >();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      bills: 0,
      sales: 0,
    }));
    const menus = new Map<
      string,
      {
        id: string;
        name: string;
        qty: number;
        sales: number;
        food: number;
        packaging: number;
        net: number;
        profit: number;
        foodCostBps: number | null;
      }
    >();
    const groups = new Map<
      string,
      {
        group: string;
        sales: number;
        net: number;
        food: number;
        packaging: number;
        profit: number;
      }
    >();
    for (const o of orders) {
      summary.sales += o.total;
      summary.net += o.netPayout;
      summary.food += o.ingredientCost;
      summary.packaging += o.packagingCost;
      summary.profit += o.grossProfit;
      const date = day(o.createdAt);
      const d = daily.get(date) ?? { date, bills: 0, sales: 0, profit: 0 };
      d.bills++;
      d.sales += o.total;
      d.profit += o.grossProfit;
      daily.set(date, d);
      const hour = new Date(o.createdAt.getTime() + 7 * 3600000).getUTCHours();
      hourly[hour].bills++;
      hourly[hour].sales += o.total;
      const group = ["DINE_IN", "TAKEAWAY"].includes(o.channel)
        ? "หน้าร้าน"
        : "เดลิเวอรี่";
      const g = groups.get(group) ?? {
        group,
        sales: 0,
        net: 0,
        food: 0,
        packaging: 0,
        profit: 0,
      };
      g.sales += o.total;
      g.net += o.netPayout;
      g.food += o.ingredientCost;
      g.packaging += o.packagingCost;
      g.profit += o.grossProfit;
      groups.set(group, g);
      for (const l of o.lines) {
        const m = menus.get(l.menuItemId) ?? {
          id: l.menuItemId,
          name: l.menuName,
          qty: 0,
          sales: 0,
          food: 0,
          packaging: 0,
          net: 0,
          profit: 0,
          foodCostBps: null,
        };
        m.qty += l.qty;
        m.sales += l.lineTotal;
        m.food += l.ingredientCost;
        m.packaging += l.packagingCost;
        m.net += l.netPayout;
        m.profit += l.netPayout - l.ingredientCost - l.packagingCost;
        menus.set(m.id, m);
      }
    }
    const allMenus = await prisma.menuItem.findMany({
      select: { id: true, name: true },
    });
    for (const m of allMenus)
      if (!menus.has(m.id))
        menus.set(m.id, {
          ...m,
          qty: 0,
          sales: 0,
          food: 0,
          packaging: 0,
          net: 0,
          profit: 0,
          foodCostBps: null,
        });
    const subtotal = orders.reduce((n, o) => n + o.subtotal, 0);
    summary.foodCostBps = subtotal
      ? roundMoney(new Decimal(summary.food).div(subtotal).mul(10000))
      : null;
    const menuRows = [...menus.values()]
      .map((m) => ({
        ...m,
        foodCostBps: m.sales
          ? roundMoney(new Decimal(m.food).div(m.sales).mul(10000))
          : null,
      }))
      .sort((a, b) => b.qty - a.qty);
    const movementRows = (type: string) =>
      movements
        .filter((m) => m.type === type)
        .map((m) => ({
          date: m.createdAt.toISOString(),
          name: m.ingredient.name,
          qty: m.qtyDelta.toString(),
          value: roundMoney(
            new Decimal(m.qtyDelta.toString()).mul(m.costAtTime.toString()),
          ),
          reason: m.reason,
        }));
    return Response.json({
      summary,
      daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      hourly,
      menus: menuRows,
      channels: [...groups.values()],
      waste: movementRows("WASTE"),
      variance: movementRows("COUNT"),
      closes,
    });
  } catch (e) {
    return fail(e, 403);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const v = z
      .object({
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        openingCash: moneySchema,
        actualCash: moneySchema,
        reason: z.string().trim().min(3).max(200),
        confirmed: z.literal(true),
      })
      .parse(await body(req));
    const bounds = dateBounds(v.businessDate, v.businessDate);
    if (bounds.gte > new Date()) throw new Error("ยังไม่ถึงวันที่เลือก");
    await serializable(async (tx) => {
      const received = await tx.payment.findMany({
        where: { method: "CASH", order: { createdAt: bounds } },
      });
      const refunded = await tx.payment.findMany({
        where: { method: "CASH", reversedAt: bounds },
      });
      const expectedCash =
        v.openingCash +
        received.reduce((n, p) => n + p.amount, 0) -
        refunded.reduce((n, p) => n + p.amount, 0);
      const saved = await tx.cashClose.create({
        data: {
          businessDate: v.businessDate,
          openingCash: v.openingCash,
          actualCash: v.actualCash,
          expectedCash,
          variance: v.actualCash - expectedCash,
          reason: v.reason,
          createdBy: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "CLOSE_DAY",
          entity: "CashClose",
          entityId: saved.id,
          beforeJson: {},
          afterJson: {
            expectedCash,
            actualCash: v.actualCash,
            reason: v.reason,
          },
        },
      });
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e, 409);
  }
}
