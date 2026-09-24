import { ensureFixtures } from "./fixtures.js";

export default async function globalSetup() {
  await ensureFixtures();
}
