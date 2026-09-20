"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet, apiPost } from "@/lib/client-api";
import { stages, stageNames } from "@/domain/delivery";
import { channelSchema, channelNames } from "@/domain/schema";
import { Button } from "@/components/ui/button";
const schema = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(["ORDER", "TICKET"]),
    queue: z.string(),
    channel: channelSchema,
    stage: z.enum(stages),
    lines: z.array(
      z.object({ name: z.string(), qty: z.number(), note: z.string() }),
    ),
  }),
);
export default function Kitchen() {
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["kitchen"],
    queryFn: () => apiGet("/api/kitchen", schema),
    refetchInterval: 3000,
  });
  return (
    <main className="p-5">
      <header className="mb-5 flex items-center justify-between">
        <h1 className="text-3xl font-bold">คิวครัว</h1>
        <Button asChild variant="outline">
          <a href="/login">เปลี่ยนผู้ใช้</a>
        </Button>
      </header>
      <p className="mb-4 text-red-700" role="status">
        {error || query.error?.message}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {query.data?.map((o) => (
          <article
            key={o.id}
            className="rounded-2xl border-t-8 border-primary bg-white p-5"
          >
            <h2 className="text-3xl font-bold">{o.queue}</h2>
            <p>
              {channelNames[o.channel]} · {stageNames[o.stage]}
            </p>
            {o.lines.map((l, i) => (
              <div key={i} className="border-b py-4">
                <strong className="text-2xl">
                  {l.qty} × {l.name}
                </strong>
                <p>{l.note}</p>
              </div>
            ))}
            {o.stage !== "SENT" && (
              <Button
                className="mt-4 w-full text-xl"
                onClick={() =>
                  void apiPost("/api/kitchen", {
                    id: o.id,
                    kind: o.kind,
                    stage: stages[stages.indexOf(o.stage) + 1],
                  })
                    .then(() => query.refetch())
                    .catch((e) =>
                      setError(
                        e instanceof Error ? e.message : "เปลี่ยนสถานะไม่ได้",
                      ),
                    )
                }
              >
                {stageNames[stages[stages.indexOf(o.stage) + 1]]}
              </Button>
            )}
          </article>
        ))}
      </div>
    </main>
  );
}
