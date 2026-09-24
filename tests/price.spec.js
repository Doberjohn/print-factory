// The printing cost: €1 per page, shown under the card count once there are cards,
// plus the cost of the next pair on the "Add two more pages" button.
import { test, expect } from "@playwright/test";
import { FIX } from "./support/fixtures.js";
import { openApp, addCards } from "./support/app.js";

test("the printing cost follows the page count", async ({ page }) => {
  await openApp(page);
  const price = page.locator("#price");
  const note = page.locator("#priceNote");
  const amount = page.locator("#priceAmount");
  const add = page.locator(".addpair");

  // No cards: nothing to print yet, so no price. The add button still shows the next pair's cost.
  await expect(price).toHaveCount(1);
  await expect(price).toBeHidden();
  await expect(add).toContainText("Pages 3 and 4, another 18 cards · +€2");

  await addCards(page, [FIX.scanPng]);
  await expect(price).toBeVisible();
  await expect(note).toHaveText("2 pages to print at €1 each");
  await expect(amount).toHaveText("€2");

  await add.click();
  await expect(amount).toHaveText("€4");
  await expect(note).toHaveText("4 pages to print at €1 each");
  await expect(add).toContainText("Pages 5 and 6, another 18 cards · +€2");

  // Adding more cards than the pages hold adds a pair on its own: 37 cards need 6 pages.
  await addCards(page, Array(36).fill(FIX.scanPng));
  await expect(amount).toHaveText("€6");

  await page.getByRole("button", { name: "Remove these pages and their 1 card" }).click();
  await expect(amount).toHaveText("€4");

  await page.click("#clear");
  await expect(price).toBeHidden();
});
