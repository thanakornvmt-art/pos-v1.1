import { z } from "zod";
import { receiptSettingsSchema } from "@/domain/printing";
import { prisma } from "@/lib/db";
import { authorized, body, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";

export async function GET() {
  try {
    await authorized();
    const store = await prisma.settings.findUniqueOrThrow({
      where: { id: "store" },
    });
    return Response.json(
      {
        settings: receiptSettingsSchema.parse(store.receiptConfig),
        shopName: store.shopName,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(error, 403);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    const value = z
      .object({ settings: receiptSettingsSchema, confirmed: z.literal(true) })
      .strict()
      .parse(await body(req));
    await serializable(async (tx) => {
      const before = await tx.settings.findUniqueOrThrow({
        where: { id: "store" },
      });
      await tx.settings.update({
        where: { id: "store" },
        data: { receiptConfig: value.settings },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "RECEIPT_SETTINGS_UPDATED",
          entity: "Settings",
          entityId: "store",
          beforeJson: before.receiptConfig ?? {},
          afterJson: value.settings,
        },
      });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return fail(error);
  }
}
