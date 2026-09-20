"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { loginSchema } from "@/domain/schema";
const usersSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    role: z.enum(["OWNER", "CASHIER", "KITCHEN"]),
  }),
);
export default function Login() {
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const users = useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const r = await fetch("/api/users");
      if (!r.ok) throw new Error("เชื่อมต่อไม่ได้");
      return usersSchema.parse(await r.json());
    },
  });
  async function login() {
    const parsed = loginSchema.safeParse({ userId, pin });
    if (!parsed.success) {
      setError("เลือกผู้ใช้และกรอก PIN 4 หลัก");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn("credentials", {
        ...parsed.data,
        redirect: false,
      });
      if (result?.ok)
        window.location.assign(
          users.data?.find((u) => u.id === userId)?.role === "KITCHEN"
            ? "/kitchen"
            : "/pos",
        );
      else {
        setError("PIN ไม่ถูกต้อง หรือถูกพักการเข้าใช้ 15 นาที");
        setPin("");
      }
    } catch {
      setError("เข้าใช้ครั้งแรกต้องเชื่อมต่ออินเทอร์เน็ต");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <section className="w-full max-w-md rounded-3xl border border-stone-200 bg-white p-8 shadow-sm">
        <div className="mb-5 text-4xl">🍲</div>
        <h1 className="text-3xl font-bold">พร้อมเปิดร้านแล้ว</h1>
        <p className="my-3 text-stone-600">เลือกชื่อ แล้วใส่รหัส PIN 4 หลัก</p>
        <label>
          ผู้ใช้งาน
          <select
            aria-label="ผู้ใช้งาน"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">เลือกผู้ใช้งาน</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <div
          aria-label={`กรอก PIN แล้ว ${pin.length} หลัก`}
          className="my-5 flex justify-center gap-5"
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-5 w-5 rounded-full ${i < pin.length ? "bg-primary" : "bg-stone-200"}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "ล้าง", "0", "ลบ"].map(
            (n) => (
              <Button
                variant="outline"
                className="text-2xl"
                key={n}
                onClick={() =>
                  setPin((p) =>
                    n === "ล้าง"
                      ? ""
                      : n === "ลบ"
                        ? p.slice(0, -1)
                        : (p + n).slice(0, 4),
                  )
                }
              >
                {n}
              </Button>
            ),
          )}
        </div>
        <p role="status" className="my-3 min-h-6 text-red-700">
          {error || (users.isError ? "ยังเชื่อมต่อฐานข้อมูลไม่ได้" : "")}
        </p>
        <Button
          className="w-full text-xl"
          disabled={busy || pin.length !== 4 || !userId}
          onClick={() => void login()}
        >
          {busy ? "กำลังเข้าใช้…" : "เข้าขายหน้าร้าน"}
        </Button>
        <a
          href="/pos"
          className="mt-3 flex min-h-16 items-center justify-center text-primary underline"
        >
          กลับไปใช้งานออฟไลน์ที่เปิดไว้
        </a>
      </section>
    </main>
  );
}
