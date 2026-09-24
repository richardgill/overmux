import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const readRepositoryFile = (path: string) =>
  readFile(resolve(repositoryRoot, path), "utf8");

test("contains component styles within their native scopes", async ({
  page,
}) => {
  const [uiStyles, xtermStyles] = await Promise.all([
    readRepositoryFile("packages/ecosystem/ui/src/styles.css"),
    readRepositoryFile("packages/ecosystem/xterm/src/styles.css"),
  ]);
  await page.setContent(`
    <div data-om-split-view-first data-outside-split-view-first></div>
    <div class="om-xterm-terminal-mount">
      <div class="xterm" data-outside-xterm></div>
    </div>
    <div data-om-split-view>
      <div data-om-split-view-first></div>
      <div data-om-split-view-separator></div>
      <div data-om-split-view-second></div>
    </div>
    <div data-om-xterm-terminal>
      <div class="om-xterm-terminal-mount"><div class="xterm"></div></div>
    </div>
  `);
  await page.addStyleTag({ content: uiStyles });
  await page.addStyleTag({ content: xtermStyles });

  await expect(page.locator("[data-om-split-view]")).toHaveCSS(
    "display",
    "flex",
  );
  await expect(page.locator("[data-outside-split-view-first]")).toHaveCSS(
    "overflow-x",
    "visible",
  );
  await expect(
    page.locator("[data-om-split-view] [data-om-split-view-first]"),
  ).toHaveCSS("overflow-x", "auto");
  await expect(page.locator("[data-outside-xterm]")).toHaveCSS(
    "display",
    "block",
  );
  await expect(page.locator("[data-om-xterm-terminal] .xterm")).toHaveCSS(
    "display",
    "flex",
  );

  await page.addStyleTag({
    content: "[data-om-split-view] { display: grid; }",
  });
  await expect(page.locator("[data-om-split-view]")).toHaveCSS(
    "display",
    "grid",
  );
});

test("stops outer theme rules at a nested theme scope", async ({ page }) => {
  const themeStyles = await readRepositoryFile(
    "packages/runtime/overmux/src/internal/client/theme-scope.css",
  );
  await page.setContent(`
    <div data-om-scope data-om-scheme="dark" data-om-contrast="normal">
      <div data-outer-value></div>
      <div data-om-scope data-om-scheme="light" data-om-contrast="normal">
        <div data-inner-value></div>
        <div data-om-overlay-root></div>
      </div>
      <div data-om-overlay-root></div>
    </div>
  `);
  await page.addStyleTag({ content: themeStyles });

  await expect(page.locator("[data-outer-value]")).toHaveCSS(
    "color",
    "rgb(242, 244, 247)",
  );
  await expect(page.locator("[data-inner-value]")).toHaveCSS(
    "color",
    "rgb(23, 32, 42)",
  );
});
