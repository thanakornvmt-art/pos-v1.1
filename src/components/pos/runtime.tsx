"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { useQuery } from "@tanstack/react-query";
import { bootstrapSchema, type Bootstrap } from "@/domain/schema";
import { localDb, deviceId } from "@/lib/offline/db";
import { syncPending } from "@/lib/offline/sync";
import { usePos } from "@/stores/pos";
const RuntimeContext = createContext<ReturnType<typeof useRuntimeState> | null>(
  null,
);
export function RuntimeProvider({ children }: { children: React.ReactNode }) {
  const runtime = useRuntimeState();
  return (
    <RuntimeContext.Provider value={runtime}>
      {children}
    </RuntimeContext.Provider>
  );
}
export function useRuntime() {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("RuntimeProvider is required");
  return runtime;
}
function useRuntimeState() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncError, setSyncError] = useState("");
  const query = useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      const id = await deviceId();
      const selected = await localDb.meta.get("selectedDraft");
      const draft = selected
        ? await localDb.drafts.get(selected.value)
        : undefined;
      const r = await fetch("/api/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: id,
          deliveryId: draft?.lines.length ? draft.deliveryId : undefined,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error("กรุณาเข้าสู่ระบบออนไลน์");
      const b = bootstrapSchema.parse(await r.json());
      await localDb.bootstrap.put({ key: "active", data: b });
      return b;
    },
    retry: false,
    refetchInterval: 300000,
  });
  useEffect(() => {
    let alive = true;
    void localDb.bootstrap
      .get("active")
      .then((c) => {
        if (alive && c) setBoot(bootstrapSchema.parse(c.data));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    const sub = liveQuery(async () => {
      const rows = await localDb.orders
        .where("state")
        .anyOf("pending", "error")
        .toArray();
      return {
        count: rows.length,
        error: rows.find((r) => r.error)?.error ?? "",
      };
    }).subscribe((v) => {
      setPending(v.count);
      setSyncError(v.error);
    });
    const ping = async () => {
      try {
        const r = await fetch("/api/health", {
          cache: "no-store",
          signal: AbortSignal.timeout(4000),
        });
        if (alive) setOnline(r.ok);
        if (r.ok) await syncPending();
      } catch {
        if (alive) setOnline(false);
      }
    };
    void ping();
    const timer = setInterval(() => void ping(), 15000);
    window.addEventListener("online", ping);
    window.addEventListener("offline", ping);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js");
    return () => {
      alive = false;
      clearInterval(timer);
      sub.unsubscribe();
      window.removeEventListener("online", ping);
      window.removeEventListener("offline", ping);
    };
  }, []);
  useEffect(() => {
    if (query.data) {
      const active = usePos.getState().draft;
      if (!active?.lines.length || !boot || boot.user.id !== query.data.user.id)
        setBoot(query.data);
    }
  }, [query.data, boot]);
  useEffect(() => {
    if (boot && "serviceWorker" in navigator)
      void navigator.serviceWorker.ready.then((reg) =>
        reg.active?.postMessage({
          type: "CACHE_MENU",
          urls: boot.catalog.menus.map((m) => m.imageUrl).filter(Boolean),
        }),
      );
  }, [boot]);
  return { boot, loaded, online, pending, syncError, refresh: query.refetch };
}
export function Connection({
  online,
  pending,
  error,
}: {
  online: boolean;
  pending: number;
  error: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-base" role="status">
      <span
        className={`h-3 w-3 rounded-full ${online ? "bg-emerald-600" : "bg-red-600"}`}
      />
      <span>{online ? "ออนไลน์" : "ออฟไลน์ · ขายต่อได้"}</span>
      <span className="rounded-full bg-stone-200 px-3 py-1">
        รอส่ง {pending} บิล
      </span>
      {error && <span className="text-red-700">ต้องตรวจสอบ: {error}</span>}
    </div>
  );
}
