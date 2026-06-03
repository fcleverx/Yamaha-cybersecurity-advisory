const { test, expect } = require("@playwright/test");
const { fixtureArticles } = require("../fixtures/articles");

async function clearBrowserState(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.locator("#fetch-st").waitFor({ state: "attached" });
  await page.locator("#articles-area .a-card, #articles-area .empty-st").first().waitFor({ state: "visible" });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await window.App.DB.clearAll();
  });
}

async function stubFeedFetch(page, articles = fixtureArticles) {
  await page.evaluate((items) => {
    window.App.RSSFetcher.fetchAllFeeds = async (_enabledFeedIds, _maxPerFeed, onProgress) => {
      onProgress?.({
        done: 1,
        total: 1,
        feedName: "Fixture Feed",
        ok: true,
        count: items.length,
        rawCount: items.length,
        elapsedMs: 5,
        newArticles: items,
      });
      return {
        articles: items,
        stats: {
          fixture: {
            name: "Fixture Feed",
            count: items.length,
            rawCount: items.length,
            ok: true,
            via: "fixture",
            elapsedMs: 5,
            urlUsed: "https://example.test/feed.xml",
            finishedAt: new Date().toISOString(),
          },
        },
        telemetry: {
          totalElapsedMs: 5,
          feedCount: 1,
          successCount: 1,
        },
      };
    };
  }, articles);
}

test.describe("deterministic critical path", () => {
  test.beforeEach(async ({ page }) => {
    await clearBrowserState(page);
  });

  test("fetches fixture articles, selects one, and builds a newsletter workspace", async ({ page }) => {
    await stubFeedFetch(page);

    await page.getByRole("button", { name: /Fetch Live News/i }).click();
    await expect(page.locator("#fetch-st")).toContainText("articles ready");
    await expect(page.locator("#articles-area .a-card")).toHaveCount(2);

    await expect(page.locator("#articles-area .a-title").first()).toContainText("QR phishing");
    await page.locator("#article-sort-select").selectOption("date_asc");
    await expect(page.locator("#articles-area .a-title").first()).toContainText("Password reset scam");
    await page.locator("#article-sort-select").selectOption("date_desc");
    await expect(page.locator("#articles-area .a-title").first()).toContainText("QR phishing");

    await page.locator("#articles-area .a-card").first().click();
    await expect(page.locator("#articles-area .a-card").first()).toHaveClass(/sel/);

    await page.getByRole("button", { name: /Generate Newsletter/i }).click();
    await expect(page).toHaveURL(/\/preview(?:\.html)?$/);
    await expect(page.locator("#nl-out")).toContainText("QR phishing");
    await expect
      .poll(async () => page.evaluate(() => document.querySelectorAll("#nl-qr img, #nl-qr canvas").length))
      .toBe(1);
    await expect(page.locator("#nl-qr canvas")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open in Editor/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save Project$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Send$/i })).toBeVisible();
    await page.locator("#ux-shell").getByRole("link", { name: "Home" }).click();
    await expect(page).toHaveURL((url) => {
      try {
        const u = new URL(url);
        const pathOk = u.pathname === "/" || u.pathname.endsWith("/index.html");
        return pathOk && (u.hash === "" || u.hash === "#section-home");
      } catch {
        return false;
      }
    });
    await expect(page.locator("#nl-out")).toContainText("QR phishing");

    const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem("awareness_newsletter_workspace_v1")));
    expect(workspace.variants.en.html).toContain("QR phishing");
    expect(workspace.articles).toHaveLength(1);
  });

  test("keeps fetch and build usable when live feeds return no articles", async ({ page }) => {
    await stubFeedFetch(page, []);

    await page.getByRole("button", { name: /Fetch Live News/i }).click();
    await expect(page.locator("#articles-area .a-card").first()).toBeVisible();
    await expect(page.locator("#status-log")).toContainText("baseline fallback articles");

    await page.getByRole("button", { name: /Generate Newsletter/i }).click();
    await expect(page).toHaveURL(/\/preview(?:\.html)?$/);
    await expect(page.locator("#nl-out")).not.toBeEmpty();
  });

  test("load from DB keeps curate and build recoverable when storage is empty", async ({ page }) => {
    await page.getByRole("button", { name: /Load from DB/i }).click();

    await expect(page.locator("#articles-area .a-card").first()).toBeVisible();
    await expect(page.locator("#fetch-st")).toContainText("baseline fallback");

    await page.getByRole("button", { name: /Generate Newsletter/i }).click();
    await expect(page).toHaveURL(/\/preview(?:\.html)?$/);
    await expect(page.locator("#nl-out")).not.toBeEmpty();
  });
});

