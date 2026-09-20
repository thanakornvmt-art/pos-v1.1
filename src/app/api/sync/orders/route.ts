import { z } from "zod";
import { orderInputSchema } from "@/domain/schema";
import { postOrder } from "@/lib/order-service";
import { body, fail, sameOrigin } from "@/lib/http";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const input = z
      .object({ order: orderInputSchema, permit: z.string().max(5000) })
      .strict()
      .parse(await body(req));
    const order = await postOrder(input.order, input.permit);
    return Response.json({
      id: order.id,
      clientUuid: order.clientUuid,
      status: order.status,
    });
  } catch (e) {
    return fail(e, 409);
  }
}
