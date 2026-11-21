import { describe, it, expect } from "vitest";

// M0 sanity: TypeScript compiles, Vitest runs, strict types enforce.
describe("tooling sanity", () => {
  it("arithmetic works (Vitest is running)", () => {
    const x: number = 1 + 1;
    expect(x).toBe(2);
  });

  it("TypeScript strict mode rejects unsafe types at compile time", () => {
    // If this file compiles, strict: true is active.
    const tuple: [string, number] = ["hello", 42];
    expect(tuple[0]).toBe("hello");
    expect(tuple[1]).toBe(42);
  });
});
