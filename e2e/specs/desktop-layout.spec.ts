import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 017: the desktop layer. Buttons size to their label from 600 px, filters share one row,
 * the workspace menu covers the sidebar, the text editor toolbar is a compact row at every width,
 * option cards have gaps and icons, and phones keep their full-width primary buttons.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value, "element has a box").not.toBeNull();
  return value!;
}

async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

test("wide screens get label-sized buttons, toolbars, and icon cards (US1, US3)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("desktop-layout"));
  await page.setViewportSize({ width: 1280, height: 900 });

  // Onboarding: the primary button is as wide as its label, not the column (FR-001).
  await page.goto("/es/onboarding");
  const next = page.getByRole("button", { name: "Continuar" });
  await expect(next).toBeVisible();
  expect((await box(next)).width).toBeLessThan(320);

  // Add property: icon cards in two columns, the recommended pill no wider than its text (FR-015).
  await page.goto("/es/properties/new");
  const cards = page.locator(".option-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(cards.first().locator(".option-icon svg")).toHaveCount(1);
  const [first, second] = [await box(cards.nth(0)), await box(cards.nth(1))];
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  const pill = page.locator(".option-card .badge").first();
  expect((await box(pill)).width).toBeLessThan(first.width / 2);
  await expectNoViolations(page, "add property at 1280px");

  // Requests: both filters on one row, each narrower than 21rem (FR-004).
  await page.goto("/es/requests");
  const fields = page.locator(".inbox-controls .toolbar-field");
  await expect(fields).toHaveCount(2);
  const [property, status] = [await box(fields.nth(0)), await box(fields.nth(1))];
  expect(Math.abs(property.y - status.y)).toBeLessThan(2);
  expect(property.width).toBeLessThanOrEqual(336);

  // The workspace menu paints above the sidebar navigation (FR-008).
  await page.goto("/es/inbox");
  await page.locator(".app-header .switcher-current").click();
  const menu = page.locator(".switcher-menu");
  await expect(menu).toBeVisible();
  const area = await box(menu);
  const topmost = await page.evaluate(
    ([x, y]) => Boolean(document.elementFromPoint(x!, y!)?.closest(".switcher-menu")),
    [area.x + area.width / 2, area.y + area.height - 12],
  );
  expect(topmost).toBe(true);

  // Settings: grouped icon cards with descriptions (FR-018).
  await page.goto("/es/settings");
  await expect(page.locator(".settings-card")).toHaveCount(10);
  await expect(page.getByRole("link", { name: /Plan y límites/ })).toContainText("límites");
  await expectNoViolations(page, "settings at 1280px");
});

test("the editor toolbar is a compact row and phones keep full-width buttons (US2)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("desktop-editor"));
  const guide = await publishGuide(page);

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/es/properties/${guide.propertyId}/guide`);
    await page.locator(".section-link").first().click();
    const toolbar = page.getByRole("toolbar").first();
    await expect(toolbar).toBeVisible();
    const bold = await box(toolbar.getByRole("button", { name: "Negrita" }));
    const italic = await box(toolbar.getByRole("button", { name: "Cursiva" }));
    // FR-009: the format buttons share a row instead of stacking at full width.
    expect(Math.abs(bold.y - italic.y), `toolbar row at ${width}px`).toBeLessThan(2);
    expect(bold.width).toBeLessThan(width / 2);
  }

  // FR-010: option cards in the property form have a gap and the brand accent.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/es/properties/new/blank");
  const choices = page.locator("fieldset .choice");
  await expect(choices.first()).toBeVisible();
  const [spanish, english] = [await box(choices.nth(0)), await box(choices.nth(1))];
  expect(english.y - (spanish.y + spanish.height)).toBeGreaterThanOrEqual(7);
  const accent = await choices
    .first()
    .locator("input")
    .evaluate((input) => getComputedStyle(input).accentColor);
  expect(accent).not.toBe("auto");

  // Phones: a form's primary button still spans the column (FR-024).
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/es/onboarding");
  const next = page.getByRole("button", { name: "Continuar" });
  await expect(next).toBeVisible();
  expect((await box(next)).width).toBeGreaterThan(300);
});
