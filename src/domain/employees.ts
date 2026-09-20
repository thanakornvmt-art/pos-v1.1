import { z } from "zod";
export const roleSchema = z.enum(["OWNER", "CASHIER", "KITCHEN"]);
export const roleLabels = {
  OWNER: "เจ้าของร้าน",
  CASHIER: "แคชเชียร์",
  KITCHEN: "ครัว",
};
const pin = z.string().regex(/^\d{4}$/, "PIN ต้องเป็นตัวเลข 4 หลัก");
const name = z.string().trim().min(1, "กรุณาใส่ชื่อพนักงาน").max(100);
export const employeeMutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      id: z.string().uuid(),
      name,
      role: roleSchema,
      pin,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      id: z.string().min(1),
      name,
      role: roleSchema,
      reason: z.string().trim().min(3).max(200),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("pin"),
      id: z.string().min(1),
      pin,
      reason: z.string().trim().min(3).max(200),
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("active"),
      id: z.string().min(1),
      active: z.boolean(),
      reason: z.string().trim().min(3).max(200),
      confirmed: z.literal(true),
    })
    .strict(),
]);
export const employeeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  active: z.boolean(),
  failedAttempts: z.number(),
  lockedUntil: z.string().nullable(),
});
export const employeeListSchema = z.object({
  currentUserId: z.string(),
  employees: z.array(employeeSchema),
});
export type Employee = z.infer<typeof employeeSchema>;
