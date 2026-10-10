import { createHash } from "node:crypto";
// Hash existing records to reject stale editors without adding a DB column.
export function recipeVersion(menu: {
  categoryId: string;
  isActive: boolean;
  bom: unknown[];
  packaging: unknown[];
}) {
  const sorted = (rows: unknown[]) =>
    rows.map((row) => JSON.stringify(row)).sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        categoryId: menu.categoryId,
        isActive: menu.isActive,
        bom: sorted(menu.bom),
        packaging: sorted(menu.packaging),
      }),
    )
    .digest("hex");
}
