import { describe, expect, it } from "vitest";
import { bahtPrice, menuCreateSchema } from "../../src/domain/menu-create";
import { channels } from "../../src/domain/schema";
const input = () => ({
  id: crypto.randomUUID(),
  name: " ข้าวใหม่ ",
  categoryId: "food",
  prices: channels.map((channel) => ({ channel, price: 4550 })),
  lines: [{ ingredientId: "rice", subRecipeId: null, qty: "0.125" }],
  confirmed: true,
});
describe("new menu validation", () => {
  it("stores satang precisely and rejects blank, negative, exponent, excessive or rounded prices", () => {
    expect(bahtPrice("45.50")).toBe(4550);
    expect(bahtPrice("0.29")).toBe(29);
    for (const v of ["", "-1", "1e2", "1.001", "1000000.01"])
      expect(() => bahtPrice(v)).toThrow();
  });
  it("requires a name, category, a positive recipe with exactly one target and confirmation", () => {
    expect(menuCreateSchema.parse(input()).name).toBe("ข้าวใหม่");
    for (const change of [
      { name: "  " },
      { categoryId: "" },
      { lines: [] },
      { confirmed: false },
      { lines: [{ ingredientId: null, subRecipeId: null, qty: "1" }] },
      { lines: [{ ingredientId: "rice", subRecipeId: "recipe", qty: "1" }] },
    ])
      expect(
        menuCreateSchema.safeParse({ ...input(), ...change }).success,
      ).toBe(false);
    for (const qty of ["0", "-1", "0.0000001", "1000000000000", "NaN"])
      expect(
        menuCreateSchema.safeParse({
          ...input(),
          lines: [{ ingredientId: "rice", subRecipeId: null, qty }],
        }).success,
      ).toBe(false);
  });
  it("rejects missing or duplicated channel prices and duplicate packaging rules", () => {
    const v = input();
    expect(
      menuCreateSchema.safeParse({ ...v, prices: v.prices.slice(1) }).success,
    ).toBe(false);
    expect(
      menuCreateSchema.safeParse({
        ...v,
        prices: v.prices.map((p) => ({ ...p, channel: "DINE_IN" })),
      }).success,
    ).toBe(false);
    const p = { channel: "TAKEAWAY", ingredientId: "box", qty: "1" };
    expect(
      menuCreateSchema.safeParse({ ...v, packaging: [p, p] }).success,
    ).toBe(false);
  });
});
