import { SignJWT, jwtVerify } from "jose";
import { grantSchema, type OrderInput } from "@/domain/schema";
function key() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("NEXTAUTH_SECRET ต้องยาวอย่างน้อย 32 ตัวอักษร");
  return new TextEncoder().encode(secret);
}
export async function issuePermit(
  userId: string,
  role: "OWNER" | "CASHIER",
  deviceId: string,
  prefix: string,
  catalogId: string,
  hours: number,
) {
  const expiresAt = Date.now() + hours * 3600000;
  const permit = await new SignJWT({ deviceId, prefix, catalogId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("morning-pos")
    .setAudience("offline-orders")
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(key());
  return { permit, expiresAt };
}
export async function verifyOrderPermit(permit: string, order: OrderInput) {
  const date = new Date(order.createdAt);
  if (date.getTime() > Date.now() + 60_000)
    throw new Error("เวลาในบิลไม่ถูกต้อง");
  const { payload } = await jwtVerify(permit, key(), {
    algorithms: ["HS256"],
    issuer: "morning-pos",
    audience: "offline-orders",
    currentDate: date,
  });
  const grant = grantSchema.parse(payload);
  if (
    date.getTime() < grant.iat * 1000 - 1000 ||
    grant.sub !== order.createdBy ||
    grant.deviceId !== order.deviceId ||
    grant.catalogId !== order.catalogId ||
    order.orderNo !==
      `${grant.prefix}-${String(order.localSequence).padStart(6, "0")}` ||
    order.queueNo !== `${grant.prefix.slice(0, 4)}-${order.localSequence}`
  )
    throw new Error("สิทธิ์หรือเลขบิลไม่ตรงกัน");
  return grant;
}
