import type { FloatingBallPosition } from "./settings";

export type FloatingBallViewport = Readonly<{ width: number; height: number }>;
export type FloatingBallPoint = Readonly<{ left: number; top: number }>;

/**
 * 将比例位置转换为视口坐标，并把球体限制在安全区域内。
 *
 * @param position 取值范围为 0..1 的比例位置。
 * @param viewport 当前视口尺寸。
 * @param ballSize 球体边长。
 * @param margin 常规视口安全边距。
 * @returns 可直接应用于固定定位宿主的左上角坐标。
 */
export function clampBallPosition(
  position: FloatingBallPosition,
  viewport: FloatingBallViewport,
  ballSize = 44,
  margin = 12,
): FloatingBallPoint {
  const availableWidth = Math.max(0, viewport.width - ballSize);
  const availableHeight = Math.max(0, viewport.height - ballSize);
  return {
    left: clampCoordinate(position.xRatio * availableWidth, availableWidth, margin),
    top: clampCoordinate(position.yRatio * availableHeight, availableHeight, margin),
  };
}

/**
 * 将球体左上角坐标转换为跨视口可恢复的比例位置。
 *
 * @param point 球体左上角坐标。
 * @param viewport 当前视口尺寸。
 * @param ballSize 球体边长。
 * @returns 每个轴均限制在 0..1 的比例位置。
 */
export function toRatioPosition(
  point: FloatingBallPoint,
  viewport: FloatingBallViewport,
  ballSize = 44,
): FloatingBallPosition {
  const availableWidth = Math.max(0, viewport.width - ballSize);
  const availableHeight = Math.max(0, viewport.height - ballSize);
  return {
    xRatio: availableWidth === 0 ? 0 : clampRatio(point.left / availableWidth),
    yRatio: availableHeight === 0 ? 0 : clampRatio(point.top / availableHeight),
  };
}

/**
 * 判断指针移动是否超过点击与拖拽的分界距离。
 *
 * @param dx 水平方向位移。
 * @param dy 垂直方向位移。
 * @param threshold 拖拽阈值，默认 5px。
 * @returns 位移欧氏距离是否严格大于阈值。
 */
export function exceedsDragThreshold(dx: number, dy: number, threshold = 5): boolean {
  return Math.hypot(dx, dy) > threshold;
}

function clampCoordinate(value: number, available: number, margin: number): number {
  const maximum = Math.max(0, available - margin);
  const minimum = Math.min(Math.max(0, margin), maximum);
  return Math.min(maximum, Math.max(minimum, value));
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, value));
}
