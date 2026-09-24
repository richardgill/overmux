import { describe, expect, it } from "vitest";

import * as ui from "./index";

describe("UI public API", () => {
  it("publishes reusable layout and selection helpers", () => {
    expect(ui).toMatchObject({
      SplitView: expect.any(Function),
      sidebarItemSchema: expect.any(Object),
      useUrlSelection: expect.any(Function),
    });
  });
});
