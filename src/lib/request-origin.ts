export function assertSameOrigin(req: Request, publicUrl: string) {
  // Next's internal request URL may use localhost behind a proxy. Compare with
  // the configured public origin, never a caller-supplied forwarded-host header.
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(publicUrl).origin)
    throw new Error("ต้นทางคำขอไม่ถูกต้อง");
}
