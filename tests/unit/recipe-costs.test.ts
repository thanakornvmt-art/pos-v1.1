import { expect, it } from "vitest";
import {
  costs,
  type AdminData,
  recipeQuantitySchema,
} from "../../src/domain/admin";
import { recipeVersion } from "../../src/lib/recipe-version";
it("includes nested recipe yield, option price and usage, channel packaging and fees once", () => {
  const data = {
    ingredients: [
      { id: "rice", avgCost: "4" },
      { id: "bowl", avgCost: "300" },
      { id: "egg", avgCost: "500" },
    ],
    recipes: [
      {
        id: "base",
        outputQty: "10",
        lines: [{ ingredientId: "rice", subRecipeId: null, qty: "100" }],
      },
    ],
    fees: [{ channel: "GRAB", feeBps: 3000 }],
  } as AdminData;
  const menu = {
    id: "m",
    name: "โจ๊ก",
    bom: [{ ingredientId: null, subRecipeId: "base", qty: "2" }],
    packaging: [{ channel: "GRAB", ingredientId: "bowl", qty: "1" }],
    prices: [
      { channel: "DINE_IN", price: 5000 },
      { channel: "GRAB", price: 6000 },
    ],
    groups: [
      {
        items: [
          {
            id: "egg-option",
            priceDelta: 1000,
            ingredientId: "egg",
            qtyDelta: "1",
          },
        ],
      },
    ],
  } as AdminData["menus"][number];
  const base = costs(data, menu).find((r) => r.channel === "GRAB")!;
  expect(base).toMatchObject({
    food: 80,
    packaging: 300,
    totalCost: 380,
    net: 4200,
    profit: 3820,
  });
  const option = costs(data, menu, ["egg-option"]).find(
    (r) => r.channel === "GRAB",
  )!;
  expect(option).toMatchObject({
    price: 7000,
    food: 580,
    packaging: 300,
    totalCost: 880,
    net: 4900,
    profit: 4020,
  });
  expect(
    costs(data, menu, ["egg-option"]).find((r) => r.channel === "DINE_IN")!
      .packaging,
  ).toBe(0);
});
it("rejects amounts that would be rounded or overflow the existing Decimal(18,6) columns", () => {
  for (const qty of ["0", "-1", "NaN", "1e2", "0.0000001", "1000000000000"])
    expect(recipeQuantitySchema.safeParse(qty).success).toBe(false);
  expect(recipeQuantitySchema.safeParse("0.000001").success).toBe(true);
});
it("recipe versions ignore DB row order but detect contents and availability changes", () => {
  const m = {
    categoryId: "c",
    isActive: true,
    bom: [
      { id: "a", qty: "1" },
      { id: "b", qty: "2" },
    ],
    packaging: [],
  };
  expect(recipeVersion(m)).toBe(
    recipeVersion({ ...m, bom: [...m.bom].reverse() }),
  );
  expect(recipeVersion(m)).not.toBe(recipeVersion({ ...m, isActive: false }));
  expect(recipeVersion(m)).not.toBe(
    recipeVersion({ ...m, bom: [{ id: "a", qty: "9" }] }),
  );
});
