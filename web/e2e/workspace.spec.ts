import { expect, test } from "@playwright/test";

import { askQuestion, DEMO_QUESTION } from "./helpers";

/**
 * Workspace flow: ask a question, get claims, click a citation, open the
 * source at its locator. This is the path the whole product exists to serve.
 */
test.describe("workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workspace");
  });

  test("a brand-new conversation invites a question, with no suggestions yet", async ({ page }) => {
    // No source has been added to this conversation, so there is nothing for
    // a suggested question to be *about* — the empty state says so rather
    // than offering one anyway.
    await expect(page.getByRole("heading", { name: /Start a conversation/i })).toBeVisible();
    await expect(page.getByText("Try one of these")).toHaveCount(0);
  });

  test("suggested questions appear once a source is attached", async ({ page }) => {
    await page.setInputFiles('input[type="file"]', {
      name: "architecture-review.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(64 * 1024, 1),
    });
    await expect(page.getByRole("heading", { name: /Ask about your sources/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Try one of these")).toBeVisible();
  });

  test("runs a query and renders claims with citation chips", async ({ page }) => {
    await askQuestion(page);

    // The answer arrives, and claims render underneath it.
    await expect(page.getByText(/Redis read-through cache/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible();

    const chips = page.getByRole("button", { name: /evidence at /i });
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test("clicking a citation opens its source at the stored locator", async ({ page }) => {
    await askQuestion(page);
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    // A citation now opens the source directly. There is no intermediate
    // inspector column to land in — that panel moved to the graph.
    await page.getByRole("button", { name: /evidence at /i }).first().click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Source record")).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Locator" })).toBeVisible();
    // Demo mode serves no bytes, and the viewer says so instead of showing a
    // broken player.
    await expect(drawer.getByText(/no media bytes are served/i)).toBeVisible();
  });

  test("View source lists the evidence the answer rests on", async ({ page }) => {
    await askQuestion(page);
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /View source/i }).first().click();
    await expect(page.getByText("Evidence this answer rests on")).toBeVisible();

    const items = page.getByRole("menuitem");
    expect(await items.count()).toBeGreaterThan(0);

    await items.first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Source record")).toBeVisible();
  });

  test("missing information is surfaced, not hidden", async ({ page }) => {
    await askQuestion(page);
    await expect(page.getByText("Missing information")).toBeVisible({ timeout: 20_000 });
  });

  test("the answer reports its own total time", async ({ page }) => {
    await askQuestion(page);
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    // Per-stage timings live in the graph's query trace now; the conversation
    // keeps the summed total beside the support pill, because an invisible
    // multi-second pause reads as a hang.
    await expect(page.getByText(/\d+\.\d+ s/).first()).toBeVisible();
  });

  test("the query persists as an investigation in the rail", async ({ page }) => {
    await askQuestion(page);
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    // Scoped by aria-current so this matches the session row itself, not the
    // per-row delete button that also carries the title in its label.
    const rail = page.getByRole("complementary", { name: "Investigations" });
    const activeRow = rail.locator('button[aria-current="true"]');
    // deriveTitle truncates past 64 characters, so the row carries a prefix.
    await expect(activeRow).toContainText(DEMO_QUESTION.slice(0, 40));

    // And survives a reload, which is what "saved" has to mean.
    await page.reload();
    await expect(rail.locator('button[aria-current="true"]')).toContainText(DEMO_QUESTION.slice(0, 40));
  });

  test("slash focuses the composer", async ({ page }) => {
    await page.locator("body").press("/");
    await expect(page.locator("[data-command-input]")).toBeFocused();
  });

  test("Cmd/Ctrl+K opens the command palette", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByPlaceholder(/Search investigations or run a command/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder(/Search investigations or run a command/i)).toBeHidden();
  });
});

test.describe("upload", () => {
  test("rejects an unsupported file before uploading anything", async ({ page }) => {
    await page.goto("/workspace");

    await page.setInputFiles('input[type="file"]', {
      name: "notes.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("nope"),
    });

    await expect(page.getByText(/not an accepted source type/i)).toBeVisible();
  });

  test("reports real upload progress and reaches a ready state", async ({ page }) => {
    await page.goto("/workspace");

    await page.setInputFiles('input[type="file"]', {
      name: "architecture-review.mp4",
      mimeType: "video/mp4",
      buffer: Buffer.alloc(256 * 1024, 1),
    });

    // A progressbar appears while bytes move, then the row settles to ready.
    await expect(page.getByRole("progressbar", { name: /Uploading architecture-review\.mp4/i })).toBeVisible();
    await expect(page.getByText("ready")).toBeVisible({ timeout: 20_000 });
  });

  test("an attached upload can be removed", async ({ page }) => {
    await page.goto("/workspace");
    await page.setInputFiles('input[type="file"]', {
      name: "slides.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(4096, 1),
    });

    await expect(page.getByText("slides.pdf")).toBeVisible();
    await page.getByRole("button", { name: /Remove slides\.pdf/i }).click();
    await expect(page.getByText("slides.pdf")).toBeHidden();
  });
});
