type Payment = { method: string; amount: number };
// Receipts belong to the sale day; reversals belong to the reversal day.
export function paymentReport(received: Payment[], reversed: Payment[]) {
  const rows = new Map<
    string,
    { method: string; received: number; reversed: number; net: number }
  >();
  for (const [kind, payments] of [
    ["received", received],
    ["reversed", reversed],
  ] as const) {
    for (const payment of payments) {
      const row = rows.get(payment.method) ?? {
        method: payment.method,
        received: 0,
        reversed: 0,
        net: 0,
      };
      row[kind] += payment.amount;
      row.net = row.received - row.reversed;
      rows.set(payment.method, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.method.localeCompare(b.method));
}
