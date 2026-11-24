import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 015: the responsive shell (US1), no cut-off text (US2), icons (US3), the branded sign-in
 * (US4), illustrated empty states (US5), and accessibility in light and dark mode.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

/** No horizontal page scroll, and no visible text cut by an ellipsis or a hyphen (FR-010, FR-011). */
async function expectNothingCut(page: Page, screen: string) {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth + 1) found.push(`page scrolls sideways (${root.scrollWidth})`);
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (!element.offsetParent && getComputedStyle(element).position !== "fixed") continue;
      // Names in compact chrome (switcher, account link) end in an ellipsis by design (founder
      // decision 2026-11-23); their full text stays in the tooltip and the accessible name.
      if (element.closest(".truncate-name")) continue;
      const style = getComputedStyle(element);
      const text = element.textContent?.trim().slice(0, 40) ?? "";
      if (!text) continue;
      if (style.textOverflow === "ellipsis" && element.scrollWidth > element.clientWidth) {
        found.push(`ellipsis: ${text}`);
      }
      if (style.hyphens === "auto") found.push(`hyphens: ${text}`);
    }
    return found;
  });
  expect(problems, `cut text on ${screen}`).toEqual([]);
}

test("the shell changes with the width and marks the current page (US1)", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("brand-shell"));

  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/es/inbox");
    const bar = page.getByRole("navigation", { name: "Guidesk" });
    await expect(bar.getByRole("link", { name: "Bandeja" })).toHaveAttribute("aria-current", "page");
    await expect(bar.getByRole("link", { name: "Propiedades" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "Más" })).toBeVisible();
    await expect(page.locator(".side-nav")).toBeHidden();
    await expectNothingCut(page, `inbox at ${width}px`);
  }

  // More opens the rest and closes with Escape, returning focus (FR-003).
  await page.getByRole("button", { name: "Más" }).click();
  await expect(page.getByRole("link", { name: "Estadísticas" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Estadísticas" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Más" })).toBeFocused();

  // Wide screens get the sidebar with every destination.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/es/settings/members");
  const side = page.locator(".side-nav");
  await expect(side).toBeVisible();
  await expect(page.locator(".bottom-bar")).toBeHidden();
  await expect(side.getByRole("link", { name: "Equipo" })).toHaveAttribute("aria-current", "page");
  await expect(side.getByRole("link", { name: "Ajustes" })).not.toHaveAttribute("aria-current", "page");
  for (const name of ["Bandeja", "Solicitudes", "Propiedades", "Estadísticas", "Contenido compartido"]) {
    await expect(side.getByRole("link", { name })).toBeVisible();
  }
  await expectNothingCut(page, "team at 1280px");
});

test("empty states and sign-in carry the brand (US4, US5)", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("brand-empty"));
  await page.goto("/es/requests");
  await expect(page.locator(".empty-state .illustration")).toBeVisible();
  await page.goto("/es/inbox");
  await expect(page.locator(".empty-state .illustration")).toBeVisible();
  await expectNoViolations(page, "inbox empty");

  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      locale: "es-CR",
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
    });
    const visitor = await context.newPage();
    await visitor.goto("/es/sign-in");
    await expect(visitor.getByRole("link", { name: "Guidesk, inicio" })).toBeVisible();
    await expect(visitor.locator(".auth-brand-panel")).toContainText(
      "Tu casa, siempre lista para responder.",
    );
    await expect(visitor.getByRole("button", { name: "Continuar con Google" }).locator("img")).toHaveAttribute(
      "src",
      "/brand/google-g.svg",
    );
    await expectNoViolations(visitor, `sign-in (${scheme})`);
    await visitor.setViewportSize({ width: 375, height: 667 });
    await expect(visitor.locator(".auth-brand-panel")).toBeHidden();
    await expect(visitor.getByRole("button", { name: "Enviarme un código" })).toBeInViewport();
    await context.close();
  }
});

test("guide tiles keep every title whole at 320 px, with icons (US2, US3)", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signIn(page, uniqueEmail("brand-guide"));
  const guide = await publishGuide(page);
  await page.goto(`/es/properties/${guide.propertyId}/share`);
  const link = (await page.locator(".share-url code").textContent()) ?? "";

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 320, height: 700 } });
  const guest = await context.newPage();
  await guest.goto(`${link}/es`);
  const tiles = guest.locator(".tile");
  await expect(tiles.first()).toBeVisible();
  const count = await tiles.count();
  for (let index = 0; index < count; index += 1) {
    await expect(tiles.nth(index).locator(".tile-icon svg")).toHaveCount(1);
  }
  // Each title fits its line box: no word is wider than the tile (no forced break).
  const overflowing = await guest.locator(".tile-title").evaluateAll((titles) =>
    titles.filter((title) => title.scrollWidth > title.clientWidth + 1).map((title) => title.textContent),
  );
  expect(overflowing).toEqual([]);
  await expectNothingCut(guest, "guide home at 320px");
  await expect(guest.locator('meta[property="og:title"]')).toHaveAttribute("content", "Casa Colibrí");
  await expectNoViolations(guest, "guide home");
  await context.close();
});
