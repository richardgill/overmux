// Native browser navigation is outside this DOM test's boundary.
// @vitest-environment-options {"settings":{"navigation":{"disableMainFrameNavigation":true,"disableChildPageNavigation":true}}}
import { createInstanceIdentity } from "@overmux/shared";
import { afterEach, expect, test as testCases, vi } from "vitest";
import { installDeepLinkNavigation } from "./deep-link-navigation";

let dispose: (() => void) | undefined;

const activateAnchor = (href: string, init: MouseEventInit = {}) => {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  const label = document.createElement("span");
  anchor.append(label);
  document.body.append(anchor);
  const event = new MouseEvent(init.button === 1 ? "auxclick" : "click", {
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  label.dispatchEvent(event);
  anchor.remove();
  return event;
};

const setup = (instanceId: string | undefined = "work-4242") => {
  const navigate = vi.fn();
  const getInstance = vi.fn(() =>
    instanceId ? createInstanceIdentity(instanceId) : undefined,
  );
  dispose = installDeepLinkNavigation({ getInstance, navigate });
  return { navigate, getInstance };
};

afterEach(() => {
  dispose?.();
  dispose = undefined;
  window.overmuxHost = undefined;
  vi.restoreAllMocks();
});

testCases.each([
  { name: "primary", init: {} },
  { name: "modified", init: { ctrlKey: true, metaKey: true } },
  { name: "middle", init: { button: 1 } },
])(
  "navigates $name activation internally with untouched route text",
  ({ init }) => {
    const { navigate } = setup();
    const route = "/tmux/1/2/%25647?x=a%20b&x=a+b&v=%2f#pane%202";

    const event = activateAnchor(`OVERMUX://work-4242${route}`, init);

    expect(event.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(route);
  },
);

testCases(
  "reads discovery on every activation and removes listeners on disposal",
  () => {
    const { navigate, getInstance } = setup();
    getInstance.mockReturnValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(activateAnchor("overmux://work-4242/path").defaultPrevented).toBe(
      true,
    );
    expect(navigate).not.toHaveBeenCalled();

    getInstance.mockReturnValue(createInstanceIdentity("work-4242"));
    activateAnchor("overmux://work-4242/path?#");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/path?#");
    getInstance.mockReturnValue(createInstanceIdentity("other"));
    activateAnchor("overmux://work-4242/old");
    expect(navigate).toHaveBeenCalledOnce();

    dispose?.();
    expect(activateAnchor("overmux://other/new").defaultPrevented).toBe(false);
    expect(navigate).toHaveBeenCalledOnce();
  },
);

testCases.each([
  "overmux://other/path",
  "overmux://work-4242:443/path",
  "overmux://user@work-4242/path",
  "overmux://work-4242//evil.test",
  "overmux://work-4242/%2fevil.test",
  "overmux://work-4242/a/%2e%2e/elsewhere",
  "overmux://work-4242/%5cevil.test",
  "overmux://work-4242/%00",
  "overmux://work-4242/%zz",
  "overmux://work-4242/path\n",
])("blocks unsupported or unsafe browser destinations: %j", (href) => {
  const { navigate } = setup();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  expect(activateAnchor(href).defaultPrevented).toBe(true);
  expect(navigate).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledOnce();
});

testCases(
  "leaves valid cross-instance links to Desktop but blocks invalid links",
  () => {
    const { navigate } = setup();
    window.overmuxHost = { version: 1, platform: "linux" };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(activateAnchor("overmux://other/route").defaultPrevented).toBe(
      false,
    );
    expect(activateAnchor("overmux://other/a/../bad").defaultPrevented).toBe(
      true,
    );
    expect(navigate).not.toHaveBeenCalled();
  },
);

testCases.each([
  "https://example.com",
  "http://example.com",
  "file:///tmp/a",
  "/local",
])("does not intercept ordinary links: %s", (href) => {
  const { navigate } = setup();
  expect(activateAnchor(href).defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});

testCases("respects application cancellation and ignores right clicks", () => {
  const { navigate } = setup();
  const cancel = (event: MouseEvent) => event.preventDefault();
  document.body.addEventListener("click", cancel);
  try {
    activateAnchor("overmux://work-4242/path");
    expect(navigate).not.toHaveBeenCalled();
  } finally {
    document.body.removeEventListener("click", cancel);
  }
  expect(
    activateAnchor("overmux://work-4242/path", { button: 2 }).defaultPrevented,
  ).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});

testCases(
  "defaults to document navigation on the current browser origin",
  () => {
    const assign = vi
      .spyOn(window.location, "assign")
      .mockImplementation(() => undefined);
    dispose = installDeepLinkNavigation({
      getInstance: () => createInstanceIdentity("not-a-hostname"),
    });

    activateAnchor("overmux://not-a-hostname/route?tab=1#pane");

    expect(assign).toHaveBeenCalledExactlyOnceWith("/route?tab=1#pane");
  },
);
