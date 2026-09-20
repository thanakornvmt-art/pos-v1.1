"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  employeeListSchema,
  employeeMutation,
  roleLabels,
  roleSchema,
  type Employee,
} from "@/domain/employees";
import { apiGet, apiPost } from "@/lib/client-api";
import { AdminShell } from "@/components/admin-shell";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
export default function Employees() {
  const router = useRouter();
  const query = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiGet("/api/employees", employeeListSchema),
  });
  const [form, setForm] = useState<{
    action: "create" | "update" | "pin" | "active";
    id: string;
    name: string;
    role: Employee["role"];
    active: boolean;
  } | null>(null);
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<z.infer<
    typeof employeeMutation
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function open(
    action: "create" | "update" | "pin" | "active",
    employee?: Employee,
  ) {
    setForm({
      action,
      id: employee?.id ?? crypto.randomUUID(),
      name: employee?.name ?? "",
      role: employee?.role ?? "CASHIER",
      active: employee ? !employee.active : true,
    });
    setPin("");
    setRepeat("");
    setReason("");
    setError("");
    setMessage("");
  }
  function prepare() {
    if (!form) return;
    try {
      if ((form.action === "create" || form.action === "pin") && pin !== repeat)
        throw new Error("PIN ทั้งสองช่องไม่ตรงกัน");
      const common = { action: form.action, id: form.id, confirmed: true };
      const data =
        form.action === "create"
          ? { ...common, name: form.name, role: form.role, pin }
          : form.action === "update"
            ? { ...common, name: form.name, role: form.role, reason }
            : form.action === "pin"
              ? { ...common, pin, reason }
              : { ...common, active: form.active, reason };
      setPending(employeeMutation.parse(data));
      setError("");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(" · ")
          : e instanceof Error
            ? e.message
            : "ข้อมูลไม่ถูกต้อง",
      );
    }
  }
  async function save() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/employees", pending);
      const ownPin =
        pending.action === "pin" && pending.id === query.data?.currentUserId;
      setPending(null);
      setForm(null);
      setPin("");
      setRepeat("");
      setMessage("บันทึกข้อมูลพนักงานแล้ว");
      if (ownPin) {
        router.push("/login");
        return;
      }
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdminShell title="จัดการพนักงาน">
      <p className="mb-4">
        เจ้าของร้านเท่านั้นที่เพิ่มบัญชี เปลี่ยนสิทธิ์ ตั้ง PIN และปิดใช้งานได้
        ประวัติธุรกรรมของพนักงานจะยังอยู่
      </p>
      {query.isError ? (
        <p role="alert" className="text-red-700">
          {query.error.message}
        </p>
      ) : (
        <>
          <Button onClick={() => open("create")} disabled={!query.data}>
            + เพิ่มพนักงาน
          </Button>
          <p role="status" className="my-3 text-primary">
            {message}
          </p>
          <div className="grid gap-4 xl:grid-cols-2">
            {query.data?.employees.map((employee) => (
              <article
                key={employee.id}
                className="rounded-2xl border border-stone-200 bg-white p-5"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold">
                      {employee.name}
                      {employee.id === query.data?.currentUserId
                        ? " (คุณ)"
                        : ""}
                    </h2>
                    <p>{roleLabels[employee.role]}</p>
                  </div>
                  <span>{employee.active ? "ใช้งาน" : "ปิดใช้งาน"}</span>
                </div>
                {employee.lockedUntil &&
                  new Date(employee.lockedUntil) > new Date() && (
                    <p className="mt-2 text-red-700">
                      พักการเข้าใช้ชั่วคราวจาก PIN ผิด
                    </p>
                  )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => open("update", employee)}
                  >
                    แก้ไขชื่อ / สิทธิ์
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => open("pin", employee)}
                  >
                    เปลี่ยน PIN
                  </Button>
                  <Button
                    variant={employee.active ? "ghost" : "default"}
                    disabled={employee.id === query.data?.currentUserId}
                    onClick={() => open("active", employee)}
                  >
                    {employee.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-5 text-stone-600">
            หลังเปลี่ยน PIN หรือสิทธิ์ ให้พนักงานเข้าสู่ระบบใหม่
            การปิดบัญชีมีผลกับคำขอออนไลน์ เครื่องออฟไลน์จะทราบเมื่อเชื่อมต่อ
            จึงควรส่งบิลค้างให้ครบก่อนปิดบัญชี
          </p>
        </>
      )}
      <Dialog
        open={Boolean(form)}
        onOpenChange={(v) => {
          if (!v && !busy) {
            setForm(null);
            setPin("");
            setRepeat("");
          }
        }}
        title={
          form?.action === "create"
            ? "เพิ่มพนักงาน"
            : form?.action === "pin"
              ? "เปลี่ยน PIN"
              : form?.action === "active"
                ? `${form.active ? "เปิด" : "ปิด"}ใช้งาน ${form.name}`
                : "แก้ไขพนักงาน"
        }
        description="PIN ใช้ตัวเลข 4 หลัก ไม่แสดง PIN เดิม และไม่บันทึก PIN ในประวัติ"
      >
        <div className="space-y-3">
          {form && (
            <>
              {["create", "update"].includes(form.action) && (
                <>
                  <label>
                    ชื่อพนักงาน
                    <input
                      maxLength={100}
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    สิทธิ์
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          role: roleSchema.parse(e.target.value),
                        })
                      }
                    >
                      {Object.entries(roleLabels).map(([role, label]) => (
                        <option value={role} key={role}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {["create", "pin"].includes(form.action) && (
                <>
                  <label>
                    PIN ใหม่
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={4}
                      value={pin}
                      onChange={(e) =>
                        setPin(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                  <label>
                    ยืนยัน PIN ใหม่
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      maxLength={4}
                      value={repeat}
                      onChange={(e) =>
                        setRepeat(e.target.value.replace(/\D/g, ""))
                      }
                    />
                  </label>
                </>
              )}
              {form.action !== "create" && (
                <label>
                  เหตุผล
                  <input
                    maxLength={200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              )}
              <p role="status" className="text-red-700">
                {error}
              </p>
              <Button onClick={prepare}>ตรวจสอบและบันทึก</Button>
            </>
          )}
        </div>
      </Dialog>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(v) => {
          if (!v && !busy) setPending(null);
        }}
        title="ยืนยันข้อมูลพนักงาน"
        description="ระบบจะบันทึกผู้แก้ไขและข้อมูลก่อน/หลังในประวัติ"
      >
        <p className="mb-3">
          {form?.name} · {form && roleLabels[form.role]}
          {form?.action === "active"
            ? ` · ${form.active ? "เปิด" : "ปิด"}ใช้งาน`
            : ""}
        </p>
        <p className="mb-3 text-red-700" role="status">
          {error}
        </p>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "กำลังบันทึก…" : "ยืนยันบันทึกพนักงาน"}
        </Button>
      </Dialog>
    </AdminShell>
  );
}
