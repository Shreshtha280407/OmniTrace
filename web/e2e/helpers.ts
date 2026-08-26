import type { Page } from "@playwright/test";

/**
 * A question fixed enough to assert on, typed straight into the composer.
 *
 * Earlier e2e coverage seeded every test by clicking one of the suggested
 * prompt buttons on the empty state. That broke twice over: the suggestions
 * now only render once the conversation already holds a source (a chat with
 * nothing in it should not dangle a question about a corpus that is not
 * there), and their copy is no longer this specific sentence — it was
 * rewritten to be corpus-agnostic. Typing into the composer directly is not
 * coupled to either of those product decisions, and it is what a real user
 * does most of the time anyway.
 *
 * The demo adapter's `demoQueryResponse` returns the same fixture bundle
 * regardless of the question text, so any non-empty string exercises the
 * identical claims/evidence/relationships this suite asserts against.
 */
export const DEMO_QUESTION = "What architecture reduced database load, who explained it, and where was it shown?";

export async function askQuestion(page: Page, question: string = DEMO_QUESTION) {
  await page.getByRole("textbox", { name: "Question for this collection" }).fill(question);
  await page.keyboard.press("Enter");
}
