import { describe, expect, it } from "vitest";
import {
  clampBallPosition,
  exceedsDragThreshold,
  toRatioPosition,
} from "../src/floating-ball/position";

describe("floating ball position", () => {
  it("places the default ratio at the bottom-right safe margin", () => {
    expect(clampBallPosition(
      { xRatio: 1, yRatio: 1 },
      { width: 1000, height: 800 },
    )).toEqual({ left: 944, top: 744 });
  });

  it("clamps restored coordinates to the safe viewport", () => {
    expect(clampBallPosition(
      { xRatio: 0, yRatio: 0 },
      { width: 1000, height: 800 },
    )).toEqual({ left: 12, top: 12 });
  });

  it("round-trips a visible point through ratio storage", () => {
    const viewport = { width: 1000, height: 800 };
    const ratio = toRatioPosition({ left: 478, top: 378 }, viewport);

    expect(ratio).toEqual({ xRatio: 0.5, yRatio: 0.5 });
    expect(clampBallPosition(ratio, viewport)).toEqual({ left: 478, top: 378 });
  });

  it("uses a five pixel euclidean drag threshold", () => {
    expect(exceedsDragThreshold(3, 4)).toBe(false);
    expect(exceedsDragThreshold(4, 4)).toBe(true);
  });

  it("keeps the ball visible in a viewport smaller than its normal footprint", () => {
    expect(clampBallPosition(
      { xRatio: 1, yRatio: 1 },
      { width: 40, height: 30 },
    )).toEqual({ left: 0, top: 0 });
  });
});
