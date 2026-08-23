import { expect, test } from "@playwright/test";

/**
 * Workspace flow: ask a question, get claims, click a citation, open the
 * source at its locator. This is the path the whole product exists to serve.
 */
test.describe("workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/workspace");
  });

  test("shows example prompts before any query has run", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Start an investigation/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /What architecture reduced database load/i }),
    ).toBeVisible();
  });

  test("runs a query and renders claims with citation chips", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();

    // The answer arrives, and claims render underneath it.
    await expect(page.getByText(/Redis read-through cache/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible();

    const chips = page.getByRole("button", { name: /evidence at /i });
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test("clicking a citation opens that evidence in the inspector", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /evidence at /i }).first().click();

    const inspector = page.getByRole("complementary", { name: "Evidence inspector" });
    await expect(inspector.getByText("Source locator")).toBeVisible();
    await expect(inspector.getByRole("button", { name: /View source/i })).toBeVisible();
  });

  test("View source opens the drawer at the stored locator", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /evidence at /i }).first().click();
    await page
      .getByRole("complementary", { name: "Evidence inspector" })
      .getByRole("button", { name: /View source/i })
      .click();

    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Source record")).toBeVisible();
    // Demo mode serves no bytes, and the viewer says so instead of showing a
    // broken player.
    await expect(drawer.getByText(/no media bytes are served/i)).toBeVisible();
  });

  test("missing information is surfaced, not hidden", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();
    await expect(page.getByText("Missing information")).toBeVisible({ timeout: 20_000 });
  });

  test("stage timings from the response are displayed", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    const inspector = page.getByRole("complementary", { name: "Evidence inspector" });
    await expect(inspector.getByText("Stage timings")).toBeVisible();
    await expect(inspector.getByText("generate")).toBeVisible();
  });

  test("the query persists as an investigation in the rail", async ({ page }) => {
    await page.getByRole("button", { name: /What architecture reduced database load/i }).click();
    await expect(page.getByRole("heading", { name: /^Claims · \d+$/ })).toBeVisible({ timeout: 20_000 });

    // Scoped by aria-current so this matches the session row itself, not the
    // per-row delete button that also carries the title in its label.
    const rail = page.getByRole("complementary", { name: "Investigations" });
    const activeRow = rail.locator('button[aria-current="true"]');
    await expect(activeRow).toContainText(/What architecture reduced database load/i);

    // And survives a reload, which is what "saved" has to mean.
    await page.reload();
    await expect(rail.locator('button[aria-current="true"]')).toContainText(
      /What architecture reduced database load/i,
    );
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
