import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";
declare module "next-auth" {
  interface User {
    role: Role;
    authVersion: number;
  }
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      role: Role;
      authVersion: number;
    };
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    role: Role;
    authVersion: number;
  }
}
