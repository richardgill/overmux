import { describe, expect, it } from "vitest";

import {
  getDesktopArtifactNames,
  getLinuxDesktopArtifactNames,
  getMacDesktopArtifactName,
  validateDesktopArtifactNames,
  validateDesktopReleaseTag,
} from "./desktop-release";

describe("desktop release metadata", () => {
  it("uses stable platform and architecture artifact names", () => {
    expect(getLinuxDesktopArtifactNames("1.2.3")).toEqual([
      "Overmux-Desktop-1.2.3-linux-x64.AppImage",
      "overmux-desktop_1.2.3_amd64.deb",
    ]);
    expect(getMacDesktopArtifactName("1.2.3", "arm64")).toBe(
      "Overmux-Desktop-1.2.3-mac-arm64.zip",
    );
    expect(getDesktopArtifactNames("1.2.3")).toEqual([
      "Overmux-Desktop-1.2.3-linux-x64.AppImage",
      "overmux-desktop_1.2.3_amd64.deb",
      "Overmux-Desktop-1.2.3-mac-arm64.zip",
      "Overmux-Desktop-1.2.3-mac-x64.zip",
    ]);
  });

  it("requires every expected artifact before aggregation", () => {
    const names = getDesktopArtifactNames("1.2.3");
    expect(() => validateDesktopArtifactNames(names, "1.2.3")).not.toThrow();
    expect(() => validateDesktopArtifactNames(names.slice(1), "1.2.3")).toThrow(
      "Aggregated desktop release artifacts",
    );
    expect(() =>
      validateDesktopArtifactNames([...names, "unexpected.zip"], "1.2.3"),
    ).toThrow("Aggregated desktop release artifacts");
  });

  it("requires an independently versioned desktop tag", () => {
    expect(() =>
      validateDesktopReleaseTag("desktop-v1.2.3", "1.2.3"),
    ).not.toThrow();
    expect(() => validateDesktopReleaseTag("v1.2.3", "1.2.3")).toThrow(
      "Desktop release tag must be desktop-v1.2.3, received v1.2.3",
    );
  });
});
