import Decimal from "decimal.js";
export interface RecipeLine {
  ingredientId: string | null;
  subRecipeId: string | null;
  qty: string;
}
export interface Recipe {
  id: string;
  outputQty: string;
  lines: RecipeLine[];
}
export function explodeBom(
  lines: RecipeLine[],
  recipes: Recipe[],
  multiplier = new Decimal(1),
  path: string[] = [],
): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  for (const l of lines) {
    const qty = new Decimal(l.qty).mul(multiplier);
    if (qty.lte(0) || Boolean(l.ingredientId) === Boolean(l.subRecipeId))
      throw new Error("BOM ไม่ถูกต้อง");
    if (l.ingredientId)
      result.set(
        l.ingredientId,
        (result.get(l.ingredientId) ?? new Decimal(0)).plus(qty),
      );
    else {
      const recipe = recipes.find((r) => r.id === l.subRecipeId);
      if (!recipe || new Decimal(recipe.outputQty).lte(0))
        throw new Error("ไม่พบสูตรหรือปริมาณผลผลิตไม่ถูกต้อง");
      if (path.includes(recipe.id)) throw new Error("สูตรวนซ้ำ");
      for (const [id, amount] of explodeBom(
        recipe.lines,
        recipes,
        qty.div(recipe.outputQty),
        [...path, recipe.id],
      ))
        result.set(id, (result.get(id) ?? new Decimal(0)).plus(amount));
    }
  }
  return result;
}
// Inventory is measured in usable usage units; cost is satang per usable unit.
export function receiveCost(
  oldQty: string,
  oldCost: string,
  purchaseQty: string,
  totalCost: number,
  conversion: string,
  yieldPercent: string,
) {
  const y = new Decimal(yieldPercent);
  if (
    y.lte(0) ||
    y.gt(100) ||
    new Decimal(conversion).lte(0) ||
    new Decimal(purchaseQty).lte(0) ||
    totalCost < 0
  )
    throw new Error("ข้อมูลรับเข้าไม่ถูกต้อง");
  const receivedQty = new Decimal(purchaseQty).mul(conversion).mul(y).div(100);
  const unitCost = new Decimal(totalCost).div(receivedQty);
  const existing = Decimal.max(0, new Decimal(oldQty));
  const avgCost = existing
    .mul(oldCost)
    .plus(totalCost)
    .div(existing.plus(receivedQty));
  return { receivedQty, unitCost, avgCost };
}
