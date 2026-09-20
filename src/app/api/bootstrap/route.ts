import { z } from "zod";
import { prisma } from "@/lib/db";
import { snapshotCatalog } from "@/lib/catalog";
import { issuePermit } from "@/lib/permit";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { catalogSchema } from "@/domain/schema";
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized();
    const { deviceId, deliveryId } = z
      .object({
        deviceId: z.string().uuid(),
        deliveryId: z.string().uuid().optional(),
      })
      .strict()
      .parse(await body(req));
    const device = await prisma.device.upsert({
      where: { id: deviceId },
      update: {},
      create: {
        id: deviceId,
        prefix: deviceId.replaceAll("-", "").toUpperCase(),
      },
    });
    if (!device.active) throw new Error("อุปกรณ์ถูกระงับ");
    let catalog = await snapshotCatalog();
    if (deliveryId) {
      const ticket = await prisma.deliveryTicket.findUniqueOrThrow({
        where: { id: deliveryId },
      });
      if (ticket.paidOrderUuid) throw new Error("บิลนี้รับเงินแล้ว");
      const snapshot = await prisma.catalogSnapshot.findUniqueOrThrow({
        where: { id: ticket.catalogId },
      });
      catalog = { id: snapshot.id, data: catalogSchema.parse(snapshot.data) };
    }
    const grant = await issuePermit(
      user.id,
      user.role as "OWNER" | "CASHIER",
      device.id,
      device.prefix,
      catalog.id,
      catalog.data.settings.offlineHours,
    );
    return Response.json(
      {
        catalog: catalog.data,
        catalogId: catalog.id,
        device: { id: device.id, prefix: device.prefix },
        user: { id: user.id, name: user.name, role: user.role },
        ...grant,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
