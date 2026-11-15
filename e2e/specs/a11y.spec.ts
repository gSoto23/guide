import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";

/**
 * Accessibility checks with axe (spec 001 T104, NFR-12): WCAG 2.2 A and AA rules on the auth,
 * onboarding, settings, and invitation screens, in Spanish and English.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser, locale = "es-CR"): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale });
  return context.newPage();
}

async function expectNoViolations(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((node) => node.target.join(" ")),
  }));
  expect(summary, `axe violations on ${screen}`).toEqual([]);
}

test("auth, onboarding, settings, and invitation screens have no WCAG A/AA violations", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("a11y");
  const page = await newPage(browser);

  await page.goto("/es/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoViolations(page, "sign-in (es)");

  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await expect(page.getByLabel("Código")).toBeVisible();
  await expectNoViolations(page, "verify");

  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoViolations(page, "onboarding");

  const settings = [
    "/es/settings",
    "/es/settings/workspace",
    "/es/settings/members",
    "/es/settings/account",
    "/es/settings/security",
    "/es/settings/security-log",
  ];
  for (const path of settings) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/…$/)).toHaveCount(0);
    await expectNoViolations(page, path);
  }

  // The invitation page as the invitee sees it before signing in.
  const invitee = uniqueEmail("a11y-invitee");
  await page.goto("/es/settings/members");
  await page.getByLabel("Email", { exact: true }).fill(invitee);
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText(`Invitación enviada a ${invitee}`)).toBeVisible();
  const { text } = await latestMessageTo(invitee);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  const guest = await newPage(browser);
  await guest.goto(invitePath);
  await expect(guest.getByRole("button", { name: "Continuar" })).toBeVisible();
  await expectNoViolations(guest, "invitation");

  // English sign-in.
  const english = await newPage(browser, "en-US");
  await english.goto("/en/sign-in");
  await expect(english.getByRole("heading", { level: 1 })).toBeVisible();
  await expectNoViolations(english, "sign-in (en)");
});
