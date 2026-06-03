const { test, expect } = require("@playwright/test");

test.describe("Newsletter HTML path helper", () => {
  test("removeNewsletterNodeByBodyChildPath removes nested element", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(() => {
      const html =
        '<div id="a"><div id="b"><span id="c">remove-me</span><span>keep</span></div></div>';
      const path = [0, 0, 0];
      return window.App.Utils.removeNewsletterNodeByBodyChildPath(html, path);
    });
    expect(out.removed).toBe(true);
    expect(out.html).not.toContain("remove-me");
    expect(out.html).toContain("keep");
  });

  test("removeNewsletterNodeByBodyChildPath returns removed false for bad path", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(() => {
      const html = "<div><p>x</p></div>";
      return window.App.Utils.removeNewsletterNodeByBodyChildPath(html, [0, 9]);
    });
    expect(out.removed).toBe(false);
    expect(out.html).toContain("<p>x</p>");
  });

  test("removeNewsletterNodeByTemplateChildPath ignores leading boilerplate", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(() => {
      const html =
        '<style data-x>/*a*/</style><div data-template-id="poster"><div><span id="t">bye</span></div></div>';
      return window.App.Utils.removeNewsletterNodeByTemplateChildPath(html, [0, 0]);
    });
    expect(out.removed).toBe(true);
    expect(out.html).not.toContain("bye");
  });

  test("removeNewsletterNodeByMirrorPath uses relPath when body path prefix differs", async ({ page }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    const out = await page.evaluate(() => {
      const html = '<div data-template-id="poster"><div><span id="t">x</span></div></div>';
      const pathBody = [1, 0, 0, 0];
      const relPath = [0, 0];
      return window.App.Utils.removeNewsletterNodeByMirrorPath(html, pathBody, relPath, 4);
    });
    expect(out.removed).toBe(true);
    expect(out.html).not.toContain(">x<");
  });
});
