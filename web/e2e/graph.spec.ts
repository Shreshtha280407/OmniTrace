import { expect, test } from "@playwright/test";

const EXAMPLE_PROMPT = /What architecture reduced database load/i;

/** Runs a query so the workspace holds an evidence bundle for the graph. */
async function seedInvestigation(page: import("@playwright/test").Page) {
  await page.goto("/workspace");
  await page.getByRole("button", { name: EXAMPLE_PROMPT }).click();
  await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });
}

test.describe("evidence graph", () => {
  test("says plainly that there is nothing to draw before any query", async ({ page }) => {
    await page.goto("/workspace/graph");
    // No fabricated graph — an explicit empty state instead.
    await expect(page.getByRole("heading", { name: /No graph to draw/i })).toBeVisible();
  });

  test("Explore graph from the inspector navigates to the focused event", async ({ page }) => {
    await seedInvestigation(page);

    const inspector = page.getByRole("complementary", { name: "Evidence inspector" });
    await inspector.getByRole("link", { name: /Explore graph/i }).click();

    await expect(page).toHaveURL(/\/workspace\/graph\?event=evt_/);
  });

  test("renders the investigation context for the loaded event", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();

    const rail = page.getByRole("complementary", { name: "Investigation context" });
    await expect(rail.getByText(/Read-through cache proposal/i)).toBeVisible();
    await expect(rail.getByText("Evidence by modality")).toBeVisible();
    await expect(rail.getByText("Evidence coverage")).toBeVisible();
  });

  test("relationship counts distinguish confirmed from tentative", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();

    const rail = page.getByRole("complementary", { name: "Investigation context" });
    await expect(rail.getByRole("switch", { name: /confirmed/i })).toBeVisible();
    await expect(rail.getByRole("switch", { name: /tentative/i })).toBeVisible();
  });

  test("mode switches between explore, query path and lineage", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();

    const modes = page.getByRole("group", { name: "Graph mode" });
    await modes.getByRole("button", { name: "Query path" }).click();
    await expect(modes.getByRole("button", { name: "Query path" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/query → seed result → event/i)).toBeVisible();

    await modes.getByRole("button", { name: "Lineage" }).click();
    await expect(page.getByText(/raw source → derived evidence → event/i)).toBeVisible();
  });

  test("the timeline scrubber filters only time-bearing evidence", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();

    await expect(page.getByText("Timeline")).toBeVisible();
    // Documents and images have no timestamp, so they get their own switch
    // rather than being silently dropped by the window.
    await expect(page.getByText(/untimed items visible/i)).toBeVisible();
    await expect(page.getByRole("slider", { name: /Window start/i })).toBeVisible();
  });

  test("reset camera control is available", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();
    await expect(page.getByRole("button", { name: /Reset camera/i })).toBeVisible();
  });

  test("back link returns to the workspace", async ({ page }) => {
    await seedInvestigation(page);
    await page.getByRole("complementary", { name: "Evidence inspector" }).getByRole("link", { name: /Explore graph/i }).click();

    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  });
});
