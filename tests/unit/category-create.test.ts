import { describe, it, expect } from "vitest";
import {
  categoryCreateSchema,
  categoryNameKey,
} from "../../src/domain/category-create";
describe("category creation validation", () => {
  it("rejects blank and long names and unconfirmed requests", () => {
    const input = { id: crypto.randomUUID(), name: "อาหาร", confirmed: true };
    for (const name of ["", " \t\n ", "ก".repeat(101)])
      expect(categoryCreateSchema.safeParse({ ...input, name }).success).toBe(
        false,
      );
    expect(
      categoryCreateSchema.safeParse({ ...input, confirmed: false }).success,
    ).toBe(false);
    expect(
      categoryCreateSchema.safeParse({ ...input, color: "arbitrary" }).success,
    ).toBe(false);
  });
  it("normalizes whitespace, unicode and case consistently for duplicate checking", () => {
    const input = {
      id: crypto.randomUUID(),
      name: "  อาหาร\t  พิเศษ  ",
      confirmed: true,
    };
    expect(categoryCreateSchema.parse(input).name).toBe("อาหาร พิเศษ");
    expect(categoryCreateSchema.parse({ ...input, name: " น้ำ " }).name).toBe(
      "น้ำ",
    );
    expect(categoryNameKey(" ＴＥＡ ")).toBe(categoryNameKey("tea"));
    expect(categoryNameKey("อาหาร\u00a0พิเศษ")).toBe(
      categoryNameKey("อาหาร พิเศษ"),
    );
  });
});
