import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "./db";
import { loginSchema } from "@/domain/schema";
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "PIN",
      credentials: {
        userId: { label: "ผู้ใช้", type: "text" },
        pin: { label: "รหัส PIN", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        return prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${parsed.data.userId} FOR UPDATE`;
            const user = await tx.user.findUnique({
              where: { id: parsed.data.userId },
            });
            if (
              !user?.active ||
              (user.lockedUntil && user.lockedUntil > new Date())
            )
              return null;
            if (!(await compare(parsed.data.pin, user.pinHash))) {
              const attempts = user.failedAttempts + 1;
              await tx.user.update({
                where: { id: user.id },
                data: {
                  failedAttempts: attempts,
                  lockedUntil:
                    attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
                },
              });
              return null;
            }
            await tx.user.update({
              where: { id: user.id },
              data: { failedAttempts: 0, lockedUntil: null },
            });
            await tx.auditLog.create({
              data: {
                userId: user.id,
                action: "LOGIN",
                entity: "User",
                entityId: user.id,
                beforeJson: {},
                afterJson: { role: user.role },
              },
            });
            return {
              id: user.id,
              name: user.name,
              role: user.role,
              authVersion: user.authVersion,
            };
          },
          { timeout: 10000 },
        );
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.sub = user.id;
        token.authVersion = user.authVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.role = token.role;
        session.user.authVersion = token.authVersion ?? 0;
      }
      return session;
    },
  },
};
