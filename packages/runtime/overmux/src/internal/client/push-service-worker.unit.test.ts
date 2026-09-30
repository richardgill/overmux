import {
  afterEach,
  beforeEach,
  expect,
  it,
  test as testCases,
  vi,
} from "vitest";

const origin = "https://overmux.test";
const showNotification = vi.fn().mockResolvedValue(undefined);
const openWindow = vi.fn().mockResolvedValue(null);
const matchAll = vi.fn().mockResolvedValue([]);
const listeners = new Map<string, (event: unknown) => void>();

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  matchAll.mockResolvedValue([]);
  listeners.clear();
  vi.stubGlobal(
    "addEventListener",
    (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
  );
  vi.stubGlobal("location", { origin });
  vi.stubGlobal("registration", { showNotification });
  vi.stubGlobal("clients", { matchAll, openWindow });
  await import("./push-service-worker");
});

afterEach(() => vi.unstubAllGlobals());

const dispatch = async (type: string, fields: object) => {
  const waitUntil = vi.fn();
  listeners.get(type)!({ ...fields, waitUntil });
  await Promise.all(waitUntil.mock.calls.map(([work]) => work));
  return waitUntil;
};

it("validates and displays the existing server payload", async () => {
  await dispatch("push", {
    data: {
      json: () => ({
        type: "notification",
        notification: {
          title: "Build finished",
          body: "Ready to review",
          open: { link: "/tmux/1?pane=2#output" },
        },
      }),
    },
  });

  expect(showNotification).toHaveBeenCalledWith("Build finished", {
    body: "Ready to review",
    icon: "/_overmux/push/icon.png",
    badge: "/_overmux/push/badge.png",
    data: { link: "/tmux/1?pane=2#output" },
  });
  expect([...listeners.keys()]).toEqual([
    "install",
    "push",
    "notificationclick",
  ]);
});

testCases.each([
  { name: "no payload", data: undefined },
  {
    name: "invalid JSON",
    data: {
      json: () => {
        throw new Error("JSON");
      },
    },
  },
  { name: "wrong shape", data: { json: () => ({ title: "not an event" }) } },
])("ignores $name", async ({ data }) => {
  const waitUntil = await dispatch("push", { data });
  expect(showNotification).not.toHaveBeenCalled();
  expect(waitUntil).not.toHaveBeenCalled();
});

testCases.each([
  {
    name: "relative route",
    link: "/tmux/1?pane=2#output",
    path: "/tmux/1?pane=2#output",
  },
  {
    name: "same-origin absolute route",
    link: `${origin}/work?x=1`,
    path: "/work?x=1",
  },
  { name: "no link", link: undefined, path: "/" },
  { name: "external URL", link: "https://other.test/", path: "/" },
  { name: "protocol-relative URL", link: "//other.test/", path: "/" },
  { name: "encoded escape", link: "/%2fother.test", path: "/" },
  { name: "script URL", link: "javascript:alert(1)", path: "/" },
])("opens a safe destination for $name", async ({ link, path }) => {
  const close = vi.fn();
  await dispatch("notificationclick", {
    notification: { close, data: { link } },
  });
  expect(close).toHaveBeenCalledOnce();
  expect(openWindow).toHaveBeenCalledWith(`${origin}${path}`);
});

it("navigates and focuses an existing same-origin window", async () => {
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue({ focus });
  matchAll.mockResolvedValue([{ url: `${origin}/old`, navigate }]);

  await dispatch("notificationclick", {
    notification: { close: vi.fn(), data: { link: "/tmux/1?pane=2#output" } },
  });

  expect(matchAll).toHaveBeenCalledWith({
    includeUncontrolled: true,
    type: "window",
  });
  expect(navigate).toHaveBeenCalledWith(`${origin}/tmux/1?pane=2#output`);
  expect(focus).toHaveBeenCalledOnce();
  expect(openWindow).not.toHaveBeenCalled();
});

it("preserves an existing window's route when no safe link is supplied", async () => {
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn();
  matchAll.mockResolvedValue([{ url: `${origin}/current`, focus, navigate }]);

  await dispatch("notificationclick", { notification: { close: vi.fn() } });

  expect(focus).toHaveBeenCalledOnce();
  expect(navigate).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});
