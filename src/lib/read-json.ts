export async function readJson(req: Request, limit = 200000): Promise<unknown> {
  const advertised = Number(req.headers.get("content-length"));
  if (advertised > limit) throw new Error("ข้อมูลใหญ่เกินกำหนด");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("ข้อมูล JSON ไม่ถูกต้อง");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error("ข้อมูลใหญ่เกินกำหนด");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    throw new Error("ข้อมูล JSON ไม่ถูกต้อง");
  }
}
