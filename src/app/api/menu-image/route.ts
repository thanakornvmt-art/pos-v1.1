import { z } from "zod";
import { authorized, fail, sameOrigin } from "@/lib/http";
import { serializable } from "@/lib/transaction";

const inputSchema = z
  .object({
    menuId: z.string().min(1).max(100),
    confirmed: z.literal(true),
    image: z
      .string()
      .max(1400000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
      .nullable(),
  })
  .strict();
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorized(true);
    // Bound the body while reading, even if Content-Length is absent or forged.
    const reader = req.body?.getReader();
    if (!reader) throw new Error("ไม่มีข้อมูลรูปภาพ");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 1450000) {
        await reader.cancel();
        throw new Error("รูปภาพใหญ่เกินกำหนด");
      }
      chunks.push(part.value);
    }
    const input = inputSchema.parse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    );
    const data = input.image
      ? Buffer.from(input.image.split(",")[1], "base64")
      : null;
    if (
      data &&
      (data.length > 1024 * 1024 ||
        data.length < 4 ||
        data[0] !== 255 ||
        data[1] !== 216 ||
        data[2] !== 255 ||
        data[data.length - 2] !== 255 ||
        data[data.length - 1] !== 217)
    )
      throw new Error("รูปภาพไม่ถูกต้องหรือใหญ่เกิน 1 MB");
    const imageUrl = await serializable(async (tx) => {
      const menu = await tx.menuItem.findUniqueOrThrow({
        where: { id: input.menuId },
      });
      const asset = data ? await tx.menuImage.create({ data: { data } }) : null;
      const url = asset ? `/menu/uploads/${asset.id}` : "";
      await tx.menuItem.update({
        where: { id: menu.id },
        data: { imageUrl: url },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "MENU_IMAGE",
          entity: "MenuItem",
          entityId: menu.id,
          beforeJson: { imageUrl: menu.imageUrl },
          afterJson: { imageUrl: url },
        },
      });
      return url;
    });
    return Response.json({ imageUrl });
  } catch (e) {
    return fail(e);
  }
}
