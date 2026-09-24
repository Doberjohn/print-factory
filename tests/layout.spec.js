// Page pairs fill each row left to right and wrap when the next one won't fit. The
// "Add two more pages" button takes the next free spot.
import { test, expect } from "@playwright/test";
import { openApp, previewSettled } from "./support/app.js";

async function addPair(page) {
  const count = await page.locator(".pair").count();
  await page.locator(".addpair").click();
  await expect(page.locator(".pair")).toHaveCount(count + 1);
  await previewSettled(page);
}

test("on a 2560 px screen, pairs sit side by side and the add button takes the next spot", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  await openApp(page);
  const pair = i => page.locator(".pair").nth(i).boundingBox();
  const add = () => page.locator(".addpair").boundingBox();

  // One pair: the add button stands to its right, as tall as the pair.
  let [first, button] = [await pair(0), await add()];
  expect(button.x).toBeGreaterThan(first.x + first.width);
  expect(Math.abs(button.y - first.y)).toBeLessThan(1);
  expect(Math.abs(button.height - first.height)).toBeLessThan(1);

  // Two pairs share the row; the add button wraps under the first as a short bar.
  await addPair(page);
  const second = await pair(1);
  first = await pair(0);
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  expect(second.x).toBeGreaterThan(first.x + first.width);
  button = await add();
  expect(button.y).toBeGreaterThan(first.y + first.height);
  expect(Math.abs(button.x - first.x)).toBeLessThan(1);
  expect(button.height).toBeLessThan(first.height / 4);

  // A third pair starts the next row, with the add button beside it again.
  await addPair(page);
  const third = await pair(2);
  button = await add();
  expect(Math.abs(third.x - first.x)).toBeLessThan(1);
  expect(Math.abs(button.y - third.y)).toBeLessThan(1);
  expect(Math.abs(button.height - third.height)).toBeLessThan(1);
});

test("on a 1920 px screen, two pairs don't fit side by side, so each gets its own row", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openApp(page);
  await addPair(page);
  const [first, second] = [await page.locator(".pair").nth(0).boundingBox(), await page.locator(".pair").nth(1).boundingBox()];
  const button = await page.locator(".addpair").boundingBox();
  expect(Math.abs(second.x - first.x)).toBeLessThan(1);
  expect(second.y).toBeGreaterThan(first.y + first.height);
  expect(button.y).toBeGreaterThan(second.y + second.height);
  expect(button.height).toBeLessThan(first.height / 4);
});
