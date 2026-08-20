import { describe, expect, it, vi } from "vitest";
import {
  FLOATING_BALL_ENABLED_KEY,
  FLOATING_BALL_POSITION_KEY,
  createFloatingBallSettingsStore,
} from "../src/floating-ball/settings";

type StorageArea = Parameters<typeof createFloatingBallSettingsStore>[0];

function createArea(stored: Record<string, unknown> = {}): StorageArea {
  return {
    get: vi.fn().mockImplementation(async () => stored),
    set: vi.fn().mockResolvedValue(undefined),
  };
}

describe("floating ball settings", () => {
  it("defaults to disabled at the bottom right", async () => {
    const area = createArea();

    await expect(createFloatingBallSettingsStore(area).load()).resolves.toEqual({
      enabled: false,
      position: { xRatio: 1, yRatio: 1 },
    });
  });

  it("loads valid persisted settings", async () => {
    const area = createArea({
      [FLOATING_BALL_ENABLED_KEY]: true,
      [FLOATING_BALL_POSITION_KEY]: { xRatio: 0.25, yRatio: 0.75 },
    });

    await expect(createFloatingBallSettingsStore(area).load()).resolves.toEqual({
      enabled: true,
      position: { xRatio: 0.25, yRatio: 0.75 },
    });
  });

  it("falls back per field when persisted settings are corrupt", async () => {
    const area = createArea({
      [FLOATING_BALL_ENABLED_KEY]: "yes",
      [FLOATING_BALL_POSITION_KEY]: { xRatio: Number.NaN, yRatio: 2 },
    });

    await expect(createFloatingBallSettingsStore(area).load()).resolves.toEqual({
      enabled: false,
      position: { xRatio: 1, yRatio: 1 },
    });
  });

  it("saves the enabled state without overwriting position", async () => {
    const area = createArea();

    await createFloatingBallSettingsStore(area).setEnabled(true);

    expect(area.set).toHaveBeenCalledWith({ [FLOATING_BALL_ENABLED_KEY]: true });
  });

  it("saves a validated position without overwriting enabled state", async () => {
    const area = createArea();

    await createFloatingBallSettingsStore(area).savePosition({ xRatio: 0.25, yRatio: 0.75 });

    expect(area.set).toHaveBeenCalledWith({
      [FLOATING_BALL_POSITION_KEY]: { xRatio: 0.25, yRatio: 0.75 },
    });
  });

  it("rejects invalid positions before writing", async () => {
    const area = createArea();

    await expect(
      createFloatingBallSettingsStore(area).savePosition({ xRatio: -1, yRatio: 0.5 }),
    ).rejects.toThrow("悬浮球位置无效");
    expect(area.set).not.toHaveBeenCalled();
  });
});
