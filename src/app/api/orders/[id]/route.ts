import { z } from "zod";
import { voidOrder } from "@/lib/void-order";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";
import { orderDetail } from "@/lib/order-history";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await authorized();
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const order = await prisma.order.findUniqueOrThrow({
      where: { clientUuid: id },
      include: { lines: true, payments: true },
    });
    const detail = await orderDetail(id, user.role === "OWNER");
    return Response.json(
      user.role === "OWNER" ? { ...order, ...detail } : detail,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const v = z
      .object({
        reason: z.string().trim().min(3).max(200),
        confirmed: z.literal(true),
      })
      .parse(await body(req));
    await serializable(async (tx) => {
      await voidOrder(tx, id, user.id, v.reason);
    });
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
