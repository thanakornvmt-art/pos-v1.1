"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Soup,
  ShoppingCart,
  Truck,
  Printer,
  BookOpen,
  Package,
  ChartColumn,
  ChefHat,
  Settings,
  Users,
} from "lucide-react";
import { RuntimeProvider, useRuntime, Connection } from "./pos/runtime";
import { Button } from "./ui/button";
import { usePos } from "@/stores/pos";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <RuntimeProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </RuntimeProvider>
  );
}

function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const runtime = useRuntime();
  const { data: session } = useSession();
  const role = session?.user.role ?? runtime.boot?.user.role;
  const name = session?.user.name ?? runtime.boot?.user.name;
  const setBillsOpen = usePos((state) => state.setBillsOpen);
  const links =
    role === "KITCHEN"
      ? [{ href: "/kitchen", label: "คิวครัว", icon: ChefHat }]
      : [
          { href: "/pos", label: "หน้าขาย (POS)", icon: ShoppingCart },
          { href: "/delivery", label: "เดลิเวอรี่", icon: Truck },
          { href: "/kitchen", label: "คิวครัว", icon: ChefHat },
          { href: "/print", label: "คิวพิมพ์", icon: Printer },
          ...(role === "OWNER"
            ? [
                { href: "/manage", label: "สูตรและต้นทุน", icon: BookOpen },
                { href: "/stock", label: "จัดการสต็อก", icon: Package },
                { href: "/reports", label: "รายงาน", icon: ChartColumn },
                { href: "/settings", label: "ตั้งค่าร้าน", icon: Settings },
                { href: "/employees", label: "จัดการพนักงาน", icon: Users },
              ]
            : []),
        ];
  return (
    <div
      className="flex h-dvh flex-col overflow-hidden print:h-auto print:overflow-visible"
      data-testid="app-shell"
    >
      <header
        data-testid="app-header"
        className="no-print flex min-h-[88px] shrink-0 items-center justify-between gap-3 border-b border-amber-400 bg-primary px-4 py-3"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Soup size={30} className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-xl font-bold">
              {runtime.boot?.catalog.settings.shopName ?? "ระบบขายหน้าร้าน"}
            </p>
            <Connection
              online={runtime.online}
              pending={runtime.pending}
              error={runtime.syncError}
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden font-semibold md:block">{name}</span>
          {pathname === "/pos" && (
            <Button variant="outline" onClick={() => setBillsOpen(true)}>
              พัก / รวมบิล
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/login">เปลี่ยนผู้ใช้</Link>
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 print:block">
        <nav
          data-testid="app-sidebar"
          aria-label="เมนูหลัก"
          className="no-print flex w-20 shrink-0 flex-col gap-2 overflow-y-auto bg-ink p-2 text-white lg:w-48 lg:p-3"
        >
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              (href === "/reports" && pathname.startsWith("/orders/"));
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                title={label}
                className={`flex min-h-16 min-w-16 shrink-0 items-center justify-center gap-3 rounded-xl px-3 font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300 lg:justify-start ${active ? "bg-primary text-ink" : "hover:bg-stone-700"}`}
              >
                <Icon className="shrink-0" size={24} />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div
          data-testid="page-content"
          className={`min-h-0 min-w-0 flex-1 print:overflow-visible ${pathname === "/pos" ? "overflow-hidden" : "overflow-y-auto"}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
