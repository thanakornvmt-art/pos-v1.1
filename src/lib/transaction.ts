import { Prisma } from "@prisma/client";
import { prisma } from "./db";
export async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let i = 0; i < 4; i++) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code) &&
        i < 3
      )
        continue;
      throw e;
    }
  }
  throw new Error("ข้อมูลถูกเปลี่ยนพร้อมกัน กรุณาลองใหม่");
}
