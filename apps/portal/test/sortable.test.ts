import { describe, expect, it } from "vitest";
import { inOrder, moveItem } from "../lib/use-sortable";

/** Feature 022 FR-007: ordering section items by dragging or with the keyboard. */
describe("moveItem", () => {
  it("moves an item up, down, and to either end", () => {
    expect(moveItem(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], "b", 99)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], "b", -5)).toEqual(["b", "a", "c"]);
  });

  it("leaves the list alone for an unknown item", () => {
    expect(moveItem(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});

describe("inOrder", () => {
  it("reorders sortable items in their own slots and keeps the others in place", () => {
    const items = [
      { id: "a", shared: false },
      { id: "s", shared: true },
      { id: "b", shared: false },
      { id: "c", shared: false },
    ];
    const laid = inOrder(items, (item) => !item.shared, ["c", "a", "b"]);
    expect(laid.map((item) => item.id)).toEqual(["c", "s", "a", "b"]);
  });
});
