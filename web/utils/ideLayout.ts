export const EDGE_BAR_WIDTH = 42;
export const DEFAULT_LEFT_FRACTION = 1.5 / 8;
export const DEFAULT_RIGHT_FRACTION = 3.5 / 8;

const ABS_MIN_PANEL_PX = 80;

function clamp(val: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, val));
}

export function getMinPanelWidth(screenWidth: number): number {
  return Math.max(ABS_MIN_PANEL_PX, Math.floor(screenWidth / 8));
}

export function getAvailablePanelWidth(screenWidth: number): number {
  const minW = getMinPanelWidth(screenWidth);
  return Math.max(minW * 3, Math.floor(screenWidth - EDGE_BAR_WIDTH * 2));
}

export interface IdePanelWidths {
  minPanelWidth: number;
  availableWidth: number;
  leftWidth: number;
  rightWidth: number;
}

export function computeIdePanelWidths(params: {
  screenWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  leftFraction: number;
  rightFraction: number;
}): IdePanelWidths {
  const minPanelWidth = getMinPanelWidth(params.screenWidth);
  const availableWidth = getAvailablePanelWidth(params.screenWidth);

  if (!params.leftOpen && !params.rightOpen) {
    return { minPanelWidth, availableWidth, leftWidth: 0, rightWidth: 0 };
  }

  if (params.leftOpen && !params.rightOpen) {
    const maxLeft = Math.max(minPanelWidth, availableWidth - minPanelWidth);
    const leftWidth = clamp(
      Math.round(params.leftFraction * availableWidth),
      minPanelWidth,
      maxLeft
    );
    return { minPanelWidth, availableWidth, leftWidth, rightWidth: 0 };
  }

  if (!params.leftOpen && params.rightOpen) {
    const maxRight = Math.max(minPanelWidth, availableWidth - minPanelWidth);
    const rightWidth = clamp(
      Math.round(params.rightFraction * availableWidth),
      minPanelWidth,
      maxRight
    );
    return { minPanelWidth, availableWidth, leftWidth: 0, rightWidth };
  }

  const rawLeft = Math.max(minPanelWidth, Math.round(params.leftFraction * availableWidth));
  const rawRight = Math.max(minPanelWidth, Math.round(params.rightFraction * availableWidth));
  const maxCombined = Math.max(minPanelWidth * 2, availableWidth - minPanelWidth);

  if (rawLeft + rawRight <= maxCombined) {
    return {
      minPanelWidth,
      availableWidth,
      leftWidth: rawLeft,
      rightWidth: rawRight,
    };
  }

  const excessLeft = rawLeft - minPanelWidth;
  const excessRight = rawRight - minPanelWidth;
  const allowedExcess = Math.max(0, maxCombined - minPanelWidth * 2);
  const totalExcess = excessLeft + excessRight;
  const scale = totalExcess > 0 ? allowedExcess / totalExcess : 0;

  const leftWidth = Math.round(minPanelWidth + excessLeft * scale);
  const rightWidth = Math.max(minPanelWidth, maxCombined - leftWidth);

  return {
    minPanelWidth,
    availableWidth,
    leftWidth,
    rightWidth,
  };
}

export function clampLeftPanelResize(params: {
  screenWidth: number;
  desiredLeftWidth: number;
  rightOpen: boolean;
  frozenRightWidth: number;
}): { leftWidth: number; leftFraction: number; rightFraction?: number } {
  const minPanelWidth = getMinPanelWidth(params.screenWidth);
  const availableWidth = getAvailablePanelWidth(params.screenWidth);
  const rightReserved = params.rightOpen ? Math.max(minPanelWidth, params.frozenRightWidth) : 0;
  const maxLeft = Math.max(minPanelWidth, availableWidth - rightReserved - minPanelWidth);
  const leftWidth = clamp(Math.round(params.desiredLeftWidth), minPanelWidth, maxLeft);

  return {
    leftWidth,
    leftFraction: leftWidth / availableWidth,
    ...(params.rightOpen ? { rightFraction: rightReserved / availableWidth } : {}),
  };
}

export function clampRightPanelResize(params: {
  screenWidth: number;
  desiredRightWidth: number;
  leftOpen: boolean;
  frozenLeftWidth: number;
}): { rightWidth: number; rightFraction: number; leftFraction?: number } {
  const minPanelWidth = getMinPanelWidth(params.screenWidth);
  const availableWidth = getAvailablePanelWidth(params.screenWidth);
  const leftReserved = params.leftOpen ? Math.max(minPanelWidth, params.frozenLeftWidth) : 0;
  const maxRight = Math.max(minPanelWidth, availableWidth - leftReserved - minPanelWidth);
  const rightWidth = clamp(Math.round(params.desiredRightWidth), minPanelWidth, maxRight);

  return {
    rightWidth,
    rightFraction: rightWidth / availableWidth,
    ...(params.leftOpen ? { leftFraction: leftReserved / availableWidth } : {}),
  };
}
