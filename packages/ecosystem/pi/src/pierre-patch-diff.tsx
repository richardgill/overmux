import { type FileDiffOptions } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { useEffect, useRef, type RefObject } from "react";

export type PierrePatchDiffProps = {
  className?: string;
  diffStyle?: "split" | "unified";
  options?: Omit<FileDiffOptions<undefined>, "diffStyle" | "disableFileHeader">;
  patch: string;
};

const selectionPoint = ({
  event,
  root,
}: {
  event: PointerEvent;
  root: ShadowRoot;
}) => {
  const position = document.caretPositionFromPoint?.(
    event.clientX,
    event.clientY,
    { shadowRoots: [root] },
  );
  if (position) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range) {
    return { node: range.startContainer, offset: range.startOffset };
  }
};

const setSelection = ({
  event,
  extend,
  root,
}: {
  event: PointerEvent;
  extend: boolean;
  root: ShadowRoot;
}) => {
  const point = selectionPoint({ event, root });
  if (!point) {
    return;
  }
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  if (extend) {
    selection.extend(point.node, point.offset);
    return;
  }
  const range = document.createRange();
  range.setStart(point.node, point.offset);
  range.collapse();
  selection.removeAllRanges();
  selection.addRange(range);
};

const isDiffText = (event: PointerEvent) =>
  event
    .composedPath()
    .some(
      (element) =>
        element instanceof HTMLElement && element.hasAttribute("data-line"),
    );

const useNativeTextSelection = (
  container: RefObject<HTMLDivElement | null>,
  patch: string,
) => {
  useEffect(() => {
    const diffContainer = container.current?.querySelector("diffs-container");
    const root = diffContainer?.shadowRoot;
    if (!(diffContainer instanceof HTMLElement) || !root) {
      return;
    }
    let selecting = false;
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.pointerType !== "mouse" ||
        event.button !== 0 ||
        !isDiffText(event)
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      selecting = true;
      setSelection({ event, extend: false, root });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!selecting) {
        return;
      }
      event.preventDefault();
      setSelection({ event, extend: true, root });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!selecting) {
        return;
      }
      event.preventDefault();
      selecting = false;
    };
    diffContainer.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    return () => {
      diffContainer.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
    };
  }, [container, patch]);
};

export const PierrePatchDiff = ({
  className,
  diffStyle = "unified",
  options,
  patch,
}: PierrePatchDiffProps) => {
  const container = useRef<HTMLDivElement>(null);
  useNativeTextSelection(container, patch);

  return (
    <div ref={container} style={{ display: "contents" }}>
      <PatchDiff
        className={className}
        disableWorkerPool
        options={{ ...options, diffStyle, disableFileHeader: true }}
        patch={patch}
      />
    </div>
  );
};
