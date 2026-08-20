export const FLOATING_BALL_ENABLED_KEY = "floatingBallEnabled";
export const FLOATING_BALL_POSITION_KEY = "floatingBallPosition";

export type FloatingBallPosition = Readonly<{
  xRatio: number;
  yRatio: number;
}>;

export type FloatingBallSettings = Readonly<{
  enabled: boolean;
  position: FloatingBallPosition;
}>;

export type FloatingBallStorageArea = {
  /**
   * 读取悬浮球持久化字段。
   *
   * @param keys 需要读取的存储键。
   * @returns 以存储键为属性的持久化数据。
   * @throws 存储实现无法完成读取时抛出异常。
   */
  get(key: string): Promise<Record<string, unknown>>;

  /**
   * 写入悬浮球持久化字段。
   *
   * @param items 需要写入的键值对。
   * @returns 写入完成时解决的 Promise。
   * @throws 存储实现无法完成写入时抛出异常。
   */
  set(items: Record<string, unknown>): Promise<void>;
};

export interface FloatingBallSettingsStore {
  /**
   * 读取并校验悬浮球设置。
   *
   * @returns 有效设置；缺失或损坏的字段使用默认值。
   * @throws 无法读取本地存储时抛出中文领域错误。
   */
  load(): Promise<FloatingBallSettings>;

  /**
   * 单独保存启用状态，不覆盖位置。
   *
   * @param enabled 是否启用网页悬浮球。
   * @returns 写入完成时解决的 Promise。
   * @throws 参数无效或无法写入本地存储时抛出中文领域错误。
   */
  setEnabled(enabled: boolean): Promise<void>;

  /**
   * 单独保存全局比例位置，不覆盖启用状态。
   *
   * @param position 取值范围为 0..1 的视口比例位置。
   * @returns 写入完成时解决的 Promise。
   * @throws 位置无效或无法写入本地存储时抛出中文领域错误。
   */
  savePosition(position: FloatingBallPosition): Promise<void>;
}

const DEFAULT_POSITION: FloatingBallPosition = Object.freeze({ xRatio: 1, yRatio: 1 });

/**
 * 创建悬浮球设置存储。
 *
 * @param area Chrome 本地存储适配器。
 * @returns 可独立读写开关与位置的设置存储。
 */
export function createFloatingBallSettingsStore(
  area: FloatingBallStorageArea,
): FloatingBallSettingsStore {
  return {
    async load() {
      let stored: Record<string, unknown>;
      try {
        const [enabled, position] = await Promise.all([
          area.get(FLOATING_BALL_ENABLED_KEY),
          area.get(FLOATING_BALL_POSITION_KEY),
        ]);
        stored = { ...enabled, ...position };
      } catch {
        throw new Error("无法读取悬浮球设置");
      }

      const rawEnabled = stored[FLOATING_BALL_ENABLED_KEY];
      const rawPosition = stored[FLOATING_BALL_POSITION_KEY];
      return {
        enabled: typeof rawEnabled === "boolean" ? rawEnabled : false,
        position: isValidPosition(rawPosition) ? copyPosition(rawPosition) : copyPosition(DEFAULT_POSITION),
      };
    },

    async setEnabled(enabled) {
      if (typeof enabled !== "boolean") {
        throw new Error("悬浮球开关无效");
      }
      try {
        await area.set({ [FLOATING_BALL_ENABLED_KEY]: enabled });
      } catch {
        throw new Error("无法保存悬浮球设置");
      }
    },

    async savePosition(position) {
      if (!isValidPosition(position)) {
        throw new Error("悬浮球位置无效");
      }
      try {
        await area.set({ [FLOATING_BALL_POSITION_KEY]: copyPosition(position) });
      } catch {
        throw new Error("无法保存悬浮球位置");
      }
    },
  };
}

function isValidPosition(value: unknown): value is FloatingBallPosition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isRatio(candidate.xRatio) && isRatio(candidate.yRatio);
}

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function copyPosition(position: FloatingBallPosition): FloatingBallPosition {
  return { xRatio: position.xRatio, yRatio: position.yRatio };
}
