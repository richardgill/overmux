import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useState,
} from "react";

export type SplitViewProps = {
  ariaLabel?: string;
  className?: string;
  defaultFirstPanelSize?: number;
  first: ReactNode;
  firstPanelSize?: number;
  maxFirstPanelSize?: number;
  minFirstPanelSize?: number;
  onFirstPanelSizeChange?: (size: number) => void;
  second: ReactNode;
  separatorClassName?: string;
  separatorFocusedClassName?: string;
  style?: CSSProperties;
};

const defaultFirstPanelSize = 320;
const keyboardStep = 10;

const clamp = (size: number, min: number, max: number) =>
  Math.min(Math.max(size, min), max);

export const SplitView = ({
  ariaLabel = "Resize panels",
  className,
  defaultFirstPanelSize: initialFirstPanelSize = defaultFirstPanelSize,
  first,
  firstPanelSize,
  maxFirstPanelSize = Number.MAX_SAFE_INTEGER,
  minFirstPanelSize = 0,
  onFirstPanelSizeChange,
  second,
  separatorClassName,
  separatorFocusedClassName,
  style,
}: SplitViewProps) => {
  const min = Math.min(minFirstPanelSize, maxFirstPanelSize);
  const max = Math.max(minFirstPanelSize, maxFirstPanelSize);
  const initialSize = clamp(initialFirstPanelSize, min, max);
  const [uncontrolledSize, setUncontrolledSize] = useState(initialSize);
  const [focused, setFocused] = useState(false);
  const size = clamp(firstPanelSize ?? uncontrolledSize, min, max);
  const separatorClassNames =
    [separatorClassName, focused ? separatorFocusedClassName : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  const setSize = (nextSize: number) => {
    const next = clamp(nextSize, min, max);
    if (firstPanelSize === undefined) {
      setUncontrolledSize(next);
    }
    onFirstPanelSizeChange?.(next);
  };
  const reset = () => setSize(initialSize);
  const resizeWithKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const sizes: Record<string, number> = {
      ArrowLeft: size - keyboardStep,
      ArrowRight: size + keyboardStep,
      End: max,
      Home: min,
    };
    if (event.key === "Enter") {
      event.preventDefault();
      reset();
      return;
    }
    const next = sizes[event.key];
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    setSize(next);
  };
  const resizeWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    const separator = event.currentTarget;
    const startX = event.clientX;
    const startSize = size;
    separator.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      setSize(startSize + moveEvent.clientX - startX);
    const stop = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", stop);
      separator.removeEventListener("pointercancel", stop);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", stop);
    separator.addEventListener("pointercancel", stop);
  };
  return (
    <div className={className} data-om-split-view="" style={style}>
      <div data-om-split-view-first="" style={{ flexBasis: `${size}px` }}>
        {first}
      </div>
      <div
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={size}
        className={separatorClassNames}
        data-om-split-view-separator=""
        data-om-focused={focused ? "" : undefined}
        onBlur={() => setFocused(false)}
        onDoubleClick={reset}
        onFocus={() => setFocused(true)}
        onKeyDown={resizeWithKey}
        onPointerDown={resizeWithPointer}
        role="separator"
        tabIndex={0}
      />
      <div data-om-split-view-second="">{second}</div>
    </div>
  );
};
