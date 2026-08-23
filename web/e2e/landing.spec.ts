import { expect, test } from "@playwright/test";

test.describe("landing page", () => {
  test("renders the hero and routes into the workspace", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /Trace every answer back to the evidence/i })).toBeVisible();

    // The demo banner must be present whenever fixtures are in play.
    await expect(page.getByText(/Every source, evidence item, relationship and answer/i)).toBeVisible();

    await page.getByRole("link", { name: /Open workspace/i }).first().click();
    await expect(page).toHaveURL(/\/workspace$/);
  });

  test("walkthrough steps are reachable by keyboard, not only by scrolling", async ({ page }) => {
    await page.goto("/");

    const rail = page.getByRole("navigation", { name: "Workflow steps" });
    await expect(rail).toBeVisible();

    const step = rail.getByRole("button", { name: /Connect evidence in time/i });
    await step.click();
    await expect(step).toHaveAttribute("aria-current", "step");
  });

  test("the six workflow steps are all present", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("navigation", { name: "Workflow steps" });
    await expect(rail.getByRole("button")).toHaveCount(6);
  });

  test("backend status reports demo mode rather than claiming health", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Demo mode · no backend connected/i)).toBeVisible();
  });
});
