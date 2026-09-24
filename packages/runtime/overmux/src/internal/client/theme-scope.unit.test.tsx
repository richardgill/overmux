import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OvermuxThemeScope } from "./theme-scope";

describe("OvermuxThemeScope", () => {
  it("renders stable theme and overlay scope attributes", () => {
    const markup = renderToStaticMarkup(
      <OvermuxThemeScope
        className="workspace"
        contrast="high"
        scheme="dark"
        style={{ "--om-color-accent": "rebeccapurple" }}
      >
        <p>Content</p>
      </OvermuxThemeScope>,
    );

    expect(markup).toContain('class="workspace"');
    expect(markup).toContain('data-om-contrast="high"');
    expect(markup).toContain('data-om-scheme="dark"');
    expect(markup).toContain("data-om-scope");
    expect(markup).toContain("data-om-overlay-root");
    expect(markup).toContain("--om-color-accent:rebeccapurple");
  });

  it("gives nested scopes their own overlay roots", () => {
    const markup = renderToStaticMarkup(
      <OvermuxThemeScope>
        <OvermuxThemeScope scheme="light">Nested</OvermuxThemeScope>
      </OvermuxThemeScope>,
    );

    expect(markup.match(/data-om-overlay-root/g)).toHaveLength(2);
    expect(markup.match(/data-om-scope/g)).toHaveLength(2);
  });
});
