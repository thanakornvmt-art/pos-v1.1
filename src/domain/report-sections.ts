export const reportSections = [
  { id: "summary", label: "สรุปยอดขาย", href: "/reports" },
  { id: "products", label: "ยอดขายตามสินค้า", href: "/reports/products" },
  {
    id: "categories",
    label: "ยอดขายแยกตามหมวดหมู่",
    href: "/reports/categories",
  },
  { id: "employees", label: "ยอดขายแยกตามพนักงาน", href: "/reports/employees" },
  {
    id: "payments",
    label: "ยอดขายแยกตามประเภทการชำระเงิน",
    href: "/reports/payments",
  },
  { id: "receipts", label: "ใบเสร็จรับเงิน", href: "/reports/receipts" },
  {
    id: "options",
    label: "ยอดขายแยกตามตัวเลือกเพิ่มเติม",
    href: "/reports/options",
  },
  { id: "discounts", label: "ส่วนลด", href: "/reports/discounts" },
  { id: "taxes", label: "ภาษี", href: "/reports/taxes" },
] as const;
export type ReportView = (typeof reportSections)[number]["id"];
export const paymentNames: Record<string, string> = {
  CASH: "เงินสด",
  PROMPTPAY: "พร้อมเพย์",
  CARD: "บัตร",
  COD: "เก็บเงินปลายทาง",
  CREDIT: "เครดิต",
};
