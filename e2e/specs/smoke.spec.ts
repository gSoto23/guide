import { expect, test } from "@playwright/test";

test("the portal home renders in Spanish and English", async ({ page }) => {
  await page.goto("/es");
  await expect(page.getByRole("heading", { name: "Guidesk" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");

  await page.goto("/en");
  await expect(page.getByText("Your property guide and AI concierge")).toBeVisible();
});
