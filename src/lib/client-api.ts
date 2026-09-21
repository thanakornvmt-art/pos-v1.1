import { z } from "zod";
export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  const r = await fetch(path, { cache: "no-store" });
  const data: unknown = await r.json();
  if (!r.ok) {
    const e = z.object({ error: z.string() }).safeParse(data);
    throw new Error(e.success ? e.data.error : "เชื่อมต่อไม่สำเร็จ");
  }
  return schema.parse(data);
}
export async function apiPost(path: string, value: unknown) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!r.ok) {
    const e = z.object({ error: z.string() }).safeParse(await r.json());
    throw new Error(e.success ? e.data.error : "บันทึกไม่สำเร็จ");
  }
}
