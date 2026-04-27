import { describe, expect, it } from "vitest";
import { maps } from "../src/engine";

describe("map topology", () => {
  it("builds rectangular boards for every map", () => {
    for (const map of maps) {
      expect(map.board).toHaveLength(map.size.height);
      for (const row of map.board) {
        expect(row).toHaveLength(map.size.width);
      }
    }
  });
});
