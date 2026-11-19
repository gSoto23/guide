import { expect, test } from "@playwright/test";

test("the portal home renders in Spanish and English", async ({ page }) => {
  await page.goto("/es");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tu casa, siempre lista para responder." }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await page.goto("/en");
  await expect(
    page.getByRole("heading", { level: 1, name: "Your home, always ready to answer." }),
  ).toBeVisible();
});
