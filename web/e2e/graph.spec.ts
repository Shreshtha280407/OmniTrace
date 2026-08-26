import { expect, test } from "@playwright/test";

import { askQuestion } from "./helpers";

/**
 * Runs a query and lands on the graph.
 *
 * The graph is reached from the conversation's own header now. It used to be
 * reached from an "Explore graph" link inside a right-hand evidence
 * inspector; that column is gone, and the marketing navbar no longer links
 * here either — the graph is drawn from one conversation's evidence bundle,
 * so it only makes sense from inside that conversation.
 */
async function seedAndOpenGraph(page: import("@playwright/test").Page) {
  await page.goto("/workspace");
  await askQuestion(page);
  await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /Evidence graph/i }).click();
  await expect(page).toHaveURL(/\/workspace\/graph$/);
}

test.describe("evidence graph", () => {
  test("says plainly that there is nothing to draw before any query", async ({ page }) => {
    await page.goto("/workspace/graph");
    // No fabricated graph — an explicit empty state instead.
    await expect(page.getByRole("heading", { name: /No graph to draw/i })).toBeVisible();
  });

  test("is reachable from the conversation that owns the evidence", async ({ page }) => {
    await seedAndOpenGraph(page);
    await expect(page.getByRole("group", { name: /^Schema graph/i })).toBeVisible();
  });

  test("renders the investigation context for the loaded event", async ({ page }) => {
    await seedAndOpenGraph(page);

    const rail = page.getByRole("complementary", { name: "Investigation context" });
    await expect(rail.getByText(/Read-through cache proposal/i)).toBeVisible();
    await expect(rail.getByText("Evidence by modality")).toBeVisible();
    await expect(rail.getByText("Evidence coverage")).toBeVisible();
  });

  test("relationship counts distinguish confirmed from tentative", async ({ page }) => {
    await seedAndOpenGraph(page);

    const rail = page.getByRole("complementary", { name: "Investigation context" });
    await expect(rail.getByRole("switch", { name: /confirmed/i })).toBeVisible();
    await expect(rail.getByRole("switch", { name: /tentative/i })).toBeVisible();
  });

  test("the legend is gone", async ({ page }) => {
    await seedAndOpenGraph(page);
    await expect(page.getByText("Legend")).toHaveCount(0);
    await expect(page.getByText(/Node colour · modality/i)).toHaveCount(0);
    await expect(page.getByText(/Node shape · kind/i)).toHaveCount(0);
  });

  test("draws exactly five nodes, one per kind, and no WebGL scene", async ({ page }) => {
    await seedAndOpenGraph(page);

    const schema = page.getByRole("group", { name: /^Schema graph/i });
    await expect(schema).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    // Five, always — the kinds are the schema, so the frame does not change
    // shape with whatever one query happened to return.
    await expect(schema.locator("button")).toHaveCount(5);
    for (const label of ["Semantic event", "Semantic segment", "Atomic observation", "Source", "Entity"]) {
      await expect(schema.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("edges are drawn between the kinds the query actually related", async ({ page }) => {
    await seedAndOpenGraph(page);

    const schema = page.getByRole("group", { name: /^Schema graph/i });
    // Give the staggered formation time to finish drawing.
    await page.waitForTimeout(2000);

    const edges = schema.locator("svg path");
    expect(await edges.count()).toBeGreaterThan(0);

    // Every edge names the relationship it aggregates and how many item-level
    // links are behind it, so the arc is readable without a legend.
    await expect(schema.locator("svg text").first()).toHaveText(/^[A-Z_]+ · \d+$/);
  });

  test("an unpopulated kind still appears, and cannot be opened", async ({ page }) => {
    await seedAndOpenGraph(page);

    // Entity is never populated by the current pipeline. It still has to be
    // drawn — a missing fifth node would read as a bug, not as an empty set.
    const entity = page
      .getByRole("group", { name: /^Schema graph/i })
      .locator("button", { hasText: "Entity" });
    await expect(entity).toBeVisible();
    await expect(entity).toBeDisabled();
  });

  test("clicking a kind opens its members, and a member opens the inspector", async ({ page }) => {
    await seedAndOpenGraph(page);

    await page
      .getByRole("group", { name: /^Schema graph/i })
      .locator("button", { hasText: "Atomic observation" })
      .click();

    const members = page.getByRole("group", { name: /Relationship graph, \d+ nodes/i });
    await expect(members).toBeVisible();

    const cards = members.locator("> div > button");
    expect(await cards.count()).toBeGreaterThan(0);
    // Only that kind's items, not the whole bundle.
    await expect(cards.first()).toContainText(/atomic observation/i);

    await cards.first().click();
    await expect(page.getByRole("complementary", { name: "Node inspector" })).toBeVisible();
  });

  test("mode switches between explore, query path and lineage", async ({ page }) => {
    await seedAndOpenGraph(page);

    const modes = page.getByRole("group", { name: "Graph mode" });
    await modes.getByRole("button", { name: "Query path" }).click();
    await expect(modes.getByRole("button", { name: "Query path" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/query → seed result → event/i)).toBeVisible();

    await modes.getByRole("button", { name: "Lineage" }).click();
    await expect(page.getByText(/raw source → derived evidence → event/i)).toBeVisible();
    // Lineage is what populates the Source kind: in explore mode it is one of
    // the empty nodes, here it gains members and becomes openable.
    const source = page
      .getByRole("group", { name: /^Schema graph/i })
      .locator("button", { hasText: "Source" });
    await expect(source).toBeEnabled();
  });

  test("query trace opens here, with the retrieval plan and stage timings", async ({ page }) => {
    await seedAndOpenGraph(page);

    await page.getByRole("button", { name: "Query trace" }).click();
    const trace = page.getByRole("complementary", { name: "Query trace" });
    await expect(trace).toBeVisible();
    await expect(trace.getByText("Query plan")).toBeVisible();
    await expect(trace.getByText("Stage timings")).toBeVisible();
    await expect(trace.getByText("generate")).toBeVisible();
  });

  test("the timeline scrubber filters only time-bearing evidence", async ({ page }) => {
    await seedAndOpenGraph(page);

    await expect(page.getByText("Timeline")).toBeVisible();
    // Documents and images have no timestamp, so they get their own switch
    // rather than being silently dropped by the window.
    await expect(page.getByText(/untimed items visible/i)).toBeVisible();
    await expect(page.getByRole("slider", { name: /Window start/i })).toBeVisible();
  });

  test("back link returns to the workspace", async ({ page }) => {
    await seedAndOpenGraph(page);

    await page.getByRole("link", { name: "Back to workspace" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  });
});
