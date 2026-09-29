import { z } from "zod";
import { prisma } from "@/lib/db";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const image = await prisma.menuImage.findUnique({ where: { id: id.data } });
  if (!image) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
