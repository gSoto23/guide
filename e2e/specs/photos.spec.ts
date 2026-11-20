import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 016: a cover photo through the real upload pipeline (US1), photo prompts (US3), and
 * initials avatars (US4). The photo is a JPEG drawn in the page.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/** A real JPEG drawn in the page (a sky, a sun, and a house front), as an upload buffer. */
async function photo(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 500;
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#7fb8d8";
    g.fillRect(0, 0, 800, 500);
    g.fillStyle = "#f5bc4c";
    g.beginPath();
    g.arc(640, 110, 55, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fbf3e6";
    g.fillRect(220, 210, 360, 200);
    g.fillStyle = "#b4452a";
    g.fillRect(370, 300, 60, 110);
    return canvas.toDataURL("image/jpeg", 0.85);
  });
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations.map((v) => ({ rule: v.id, targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")) })),
    `axe violations on ${screen}`,
  ).toEqual([]);
}

test("a cover photo shows on the property, the list, and the guest guide (US1)", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  await signIn(page, uniqueEmail("photos-cover"));
  const guide = await publishGuide(page);

  await page.goto(`/es/properties/${guide.propertyId}`);
  await expect(page.getByText("Agrega una foto de portada")).toBeVisible();
  await page
    .locator(".cover-actions input[type=file]")
    .setInputFiles({ name: "casa.jpg", mimeType: "image/jpeg", buffer: await photo(page) });
  // Processing runs in the worker; the cover appears once the photo is ready.
  await expect(page.locator("img.cover-photo")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("status")).toContainText("Foto de portada guardada.");
  await page.getByLabel("Descripción de la foto").fill("Fachada con palmeras");
  await page.getByRole("button", { name: "Guardar descripción" }).click();
  await expect(page.locator("img.cover-photo")).toHaveAttribute("alt", "Fachada con palmeras");
  await expectNoViolations(page, "property with a cover");

  await page.goto("/es/properties");
  await expect(page.locator("img.property-thumb")).toHaveCount(1);

  await page.goto(`/es/properties/${guide.propertyId}/share`);
  const link = (await page.locator(".share-url code").textContent()) ?? "";
  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(`${link}/es`);
  const cover = guest.locator("img.cover");
  await expect(cover).toHaveAttribute("alt", "Fachada con palmeras");
  await expect(guest.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/api\/v1\/guest\/media\/.+\/large$/,
  );
  await context.close();
});

test("sections suggest photos and the team shows initials (US3, US4)", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("photos-prompt"));
  const guide = await publishGuide(page);
  await page.goto(`/es/properties/${guide.propertyId}/guide`);
  await page.getByRole("link", { name: "Llegada y acceso" }).first().click();
  await expect(page.locator(".photo-prompt")).toContainText("Una foto de la puerta");

  await page.goto("/es/settings/members");
  await expect(page.locator(".member-row .avatar")).toHaveCount(1);
});
