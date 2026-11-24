import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Feature 014: the public home, privacy policy, and terms (US1, US2), the consent line, robots and
 * sitemap, and accessibility. Synthetic visitor only; no account needed.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

/** Every request the page makes, to check that none leaves the portal's origin (AC-SEC-006). */
function recordRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

test("the home page explains Guidesk, shows the plans, and starts free (US1)", async ({
  page,
  baseURL,
}) => {
  const requests = recordRequests(page);
  await page.goto("/es");
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tu casa, siempre lista para responder.",
  );
  await expect(page.locator(".public-steps > li")).toHaveCount(3);
  await expect(page.getByRole("heading", { level: 2, name: "Lo que hace Guidesk" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "Chat con IA en la guía" }),
  ).toBeVisible();

  const plans = page.locator("#plans");
  await expect(plans.getByText("Gratis durante el piloto")).toBeVisible();
  await expect(plans.getByText("USD 0")).toBeVisible();
  await expect(plans.getByText("2 propiedades activas")).toBeVisible();
  await expect(plans.getByText("500 respuestas de IA al mes")).toBeVisible();
  await expect(plans.getByText("1 puesto", { exact: true })).toBeVisible();
  await expect(plans.getByText("Precio por anunciar")).toHaveCount(2);
  await expect(plans.getByText(/Comisión en extras: 10\s?%/)).toBeVisible();
  await expect(plans.getByText(/Comisión en extras: 7\s?%/)).toBeVisible();
  await expect(plans.getByText(/Comisión en extras: 5\s?%/)).toBeVisible();

  const footer = page.locator(".public-footer");
  await expect(footer.getByRole("link", { name: "Privacidad" })).toHaveAttribute(
    "href",
    "/es/privacy",
  );
  await expect(footer.getByRole("link", { name: "Términos" })).toHaveAttribute("href", "/es/terms");
  await expect(footer.getByText(/© \d{4} /)).toBeVisible();

  const origin = new URL(baseURL ?? "http://localhost:3000").origin;
  expect(requests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:"))).toEqual([]);

  await page.getByRole("link", { name: "English" }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your home, always ready to answer.",
  );
  await expect(page.locator("#plans").getByText("Price to be announced")).toHaveCount(2);

  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/\/en\/sign-in$/);
});

test("the privacy policy and the terms say what Guidesk does (US2)", async ({ page }) => {
  await page.goto("/es/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Política de privacidad");
  await expect(page.getByText(/^Última actualización: \d{1,2} de \w+ de \d{4}$/)).toBeVisible();
  for (const provider of [
    "Amazon Web Services",
    "us-east-1",
    "Anthropic",
    "Amazon SES",
    "Google",
    "Viator y Civitatis",
    "Sentry",
  ]) {
    await expect(page.locator("#providers")).toContainText(provider);
  }
  await expect(page.locator("#retention")).toContainText("12 meses después de la salida");
  await expect(page.locator("#cookies")).toContainText("No usamos cookies de analítica");
  await expect(page.locator("#rights")).toContainText("30 días");
  await expect(page.locator("#ai")).toContainText("Nunca enviamos al proveedor de IA los códigos");

  await page.goto("/en/terms");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
  await expect(page.locator("#law")).toContainText("laws of Costa Rica");
  await expect(page.locator("#payments")).toContainText("Free 10%, Pro 7%, and Business 5%");
  await expect(page.locator("#assistant")).toContainText("not an emergency service");
  await expect(page.locator("section[id]")).toHaveCount(
    await page.locator(".legal-toc li").count(),
  );
});

test("sign-in and invitations show the consent line with both links (FR-009)", async ({ page }) => {
  await page.goto("/es/sign-in");
  const consent = page.locator(".consent-line");
  await expect(consent).toContainText("Al continuar, aceptas los");
  await expect(consent.getByRole("link", { name: "Términos" })).toHaveAttribute(
    "href",
    "/es/terms",
  );
  await expect(consent.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute(
    "href",
    "/es/privacy",
  );

  await page.goto("/en/invite/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
  await expect(page.locator(".consent-line").getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "/en/terms",
  );
});

test("robots and the sitemap list only the public pages (AC-SEC-005)", async ({ request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /es$");
  expect(robots).toContain("Disallow: /");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1]!).pathname,
  );
  expect(urls).toEqual(["/es", "/en", "/es/privacy", "/en/privacy", "/es/terms", "/en/terms"]);
});

test("the public pages have no WCAG A/AA violations", async ({ page }) => {
  for (const path of ["/es", "/en", "/es/privacy", "/en/terms"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(page, path);
  }
});
