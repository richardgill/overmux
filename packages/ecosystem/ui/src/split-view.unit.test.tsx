import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test as testCases,
  vi,
} from "vitest";

import { SplitView } from "./split-view";

let container: HTMLDivElement;
let root: Root;

const separator = () => {
  const element = container.querySelector<HTMLDivElement>('[role="separator"]');
  if (!element) {
    throw new Error("Missing split view separator");
  }
  return element;
};

const firstPanel = () => {
  const element = container.querySelector<HTMLDivElement>(
    "[data-om-split-view-first]",
  );
  if (!element) {
    throw new Error("Missing first split view panel");
  }
  return element;
};

const dispatchPointer = (element: HTMLElement, type: string, clientX: number) =>
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, clientX, pointerId: 1 }),
  );

const ControlledSplitView = ({
  onChange,
}: {
  onChange: (size: number) => void;
}) => {
  const [size, setSize] = useState(200);
  return (
    <SplitView
      first="first"
      firstPanelSize={size}
      onFirstPanelSizeChange={(next) => {
        onChange(next);
        setSize(next);
      }}
      second="second"
    />
  );
};

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SplitView", () => {
  testCases("manages its default first panel size and reset", async () => {
    await act(async () =>
      root.render(
        <SplitView
          className="split"
          defaultFirstPanelSize={200}
          first="first"
          maxFirstPanelSize={300}
          minFirstPanelSize={100}
          second="second"
          style={{ backgroundColor: "red" }}
        />,
      ),
    );

    expect(firstPanel().style.flexBasis).toBe("200px");
    expect(container.firstElementChild?.className).toBe("split");
    expect(container.firstElementChild?.getAttribute("style")).toContain(
      "background-color: red",
    );

    await act(async () =>
      separator().dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }),
      ),
    );
    expect(firstPanel().style.flexBasis).toBe("210px");

    await act(async () =>
      separator().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(firstPanel().style.flexBasis).toBe("200px");
  });

  testCases("supports controlled sizes and pointer dragging", async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(<ControlledSplitView onChange={onChange} />),
    );

    await act(async () => {
      dispatchPointer(separator(), "pointerdown", 100);
      dispatchPointer(separator(), "pointermove", 160);
      dispatchPointer(separator(), "pointerup", 160);
    });

    expect(onChange).toHaveBeenLastCalledWith(260);
    expect(firstPanel().style.flexBasis).toBe("260px");
  });

  testCases(
    "provides accessible keyboard resizing and focus seams",
    async () => {
      await act(async () =>
        root.render(
          <SplitView
            defaultFirstPanelSize={200}
            first="first"
            maxFirstPanelSize={300}
            minFirstPanelSize={100}
            second="second"
            separatorClassName="separator"
            separatorFocusedClassName="focused"
          />,
        ),
      );

      const element = separator();
      expect(element.getAttribute("aria-label")).toBe("Resize panels");
      expect(element.getAttribute("aria-orientation")).toBe("vertical");
      expect(element.getAttribute("aria-valuemin")).toBe("100");
      expect(element.getAttribute("aria-valuemax")).toBe("300");
      expect(element.getAttribute("aria-valuenow")).toBe("200");

      await act(async () => element.focus());
      expect(element.classList).toContain("separator");
      expect(element.classList).toContain("focused");

      await act(async () =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
        ),
      );
      expect(element.getAttribute("aria-valuenow")).toBe("300");
      await act(async () =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
        ),
      );
      expect(element.getAttribute("aria-valuenow")).toBe("100");
      await act(async () =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
        ),
      );
      expect(element.getAttribute("aria-valuenow")).toBe("200");
    },
  );
});
