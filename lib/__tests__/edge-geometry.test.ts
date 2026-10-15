import { describe, expect, it } from "vitest";
import { centerEdgeEndpoint } from "../edge-geometry";

describe("completed edge alignment", () => {
  it.each([
    ["left", { x: 100, y: 240 }],
    ["right", { x: 180, y: 240 }],
    ["top", { x: 140, y: 200 }],
    ["bottom", { x: 140, y: 280 }],
  ] as const)("lands on the same center from a %s handle edge", (position, edge) => {
    expect(centerEdgeEndpoint(edge, position, { width: 80, height: 80 })).toEqual({ x: 140, y: 240 });
  });

  it("uses measured width and height independently, without a fixed dot-size assumption", () => {
    const handle = { width: 12, height: 20 };
    expect(centerEdgeEndpoint({ x: 106, y: 200 }, "right", handle)).toEqual({ x: 100, y: 200 });
    expect(centerEdgeEndpoint({ x: 100, y: 210 }, "bottom", handle)).toEqual({ x: 100, y: 200 });
  });

  it("remains aligned after pan and zoom transforms", () => {
    const center = centerEdgeEndpoint({ x: 243, y: 208 }, "right", { width: 8, height: 8 });
    for (const zoom of [0.5, 1.10833, 2]) {
      expect(center.x * zoom + 102.875).toBeCloseTo(239 * zoom + 102.875);
      expect(center.y * zoom + 188.6167).toBeCloseTo(208 * zoom + 188.6167);
    }
  });

  it("preserves the supplied point before dimensions are available", () => {
    expect(centerEdgeEndpoint({ x: 100, y: 200 }, "left")).toEqual({ x: 100, y: 200 });
  });
});
