import { z } from "zod";
import { dateRangeSchema } from "./reports";
export const auditQuerySchema = z
  .object({
    from: z.string(),
    to: z.string(),
    action: z.string().trim().max(80).default(""),
    entityId: z.string().trim().max(100).default(""),
    cursor: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    const range = dateRangeSchema.safeParse(value);
    if (!range.success)
      ctx.addIssue({ code: "custom", message: "ช่วงวันไม่ถูกต้อง" });
  });
export const auditViewSchema = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      action: z.string(),
      entity: z.string(),
      entityId: z.string(),
      createdAt: z.string(),
      user: z.object({ name: z.string() }),
      beforeJson: z.unknown(),
      afterJson: z.unknown(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export function redactAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAudit);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /pin|password|secret|token|permit|database.?url/i.test(key)
          ? "[ปกปิด]"
          : redactAudit(item),
      ]),
    );
  return value;
}
