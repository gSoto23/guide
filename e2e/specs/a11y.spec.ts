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

/** Feature 002 screens (T125): every property screen, in the states a host sees them. */
test("property screens have no WCAG A/AA violations", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("a11y-properties");
  const page = await newPage(browser);
  const day = (offset: number) =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const settled = async (path: string) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/^Cargando/)).toHaveCount(0);
    await expectNoViolations(page, path);
  };

  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);

  // The starting options, the listing flow, PMS import, CSV, and the confirmation step.
  for (const path of [
    "/es/properties",
    "/es/properties/new",
    "/es/properties/new/listing",
    "/es/properties/new/pms",
    "/es/properties/new/csv",
    "/es/properties/new/blank",
  ]) {
    await page.goto(path);
    await settled(path);
  }

  // A property's page, with its calendar and stay forms open.
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Colibrí");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Colibrí" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Próximas estadías" })).toBeVisible();
  await settled("property");
  const propertyUrl = page.url();
  await page.getByRole("button", { name: "Agregar un calendario" }).click();
  await settled("calendar form");
  await page.getByRole("button", { name: "Agregar una estadía a mano" }).click();
  await page.getByLabel(/^Fecha de entrada/).fill(day(5));
  await page.getByLabel(/^Fecha de salida/).fill(day(8));
  await page.getByLabel("Cantidad de huéspedes").fill("2");
  await page.getByRole("button", { name: "Agregar estadía" }).click();
  await expect(page.getByText("Estadía agregada.")).toBeVisible();
  await settled("stays");

  // The list with a property, and the copy's confirmation step.
  await page.goto("/es/properties");
  await expect(page.getByRole("link", { name: /Casa Colibrí/ })).toBeVisible();
  await settled("list");
  await page.goto(propertyUrl);
  await page.getByRole("link", { name: "Duplicar" }).click();
  await expect(page.getByText("Copia de «Casa Colibrí»")).toBeVisible();
  await settled("duplicate");

  // The CSV review and the import run.
  await page.goto("/es/properties/new/csv");
  await page.getByLabel("Elegir archivo").setInputFiles({
    name: "propiedades.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "﻿Nombre;País;Ciudad;Calle y número;Zona horaria\r\n" +
        "Cabina Norte;CR;Sámara;Calle Ficticia 9;America/Costa_Rica\r\n" +
        "Cabina Sur;CR;Sámara;Calle Ficticia 11;Marte/Olimpo\r\n",
      "utf8",
    ),
  });
  await page.getByRole("button", { name: "Revisar el archivo" }).click();
  await expect(page.getByRole("heading", { name: "Revisa el archivo" })).toBeVisible({
    timeout: 60_000,
  });
  await settled("CSV review");
  await page.getByRole("button", { name: "Crear 1 propiedad" }).click();
  await expect(page.getByText("La importación terminó")).toBeVisible({ timeout: 60_000 });
  await settled("import run");

  // Removing, and the removed list.
  await page.goto(propertyUrl);
  await page.getByRole("button", { name: "Eliminar propiedad" }).click();
  await expect(page.getByText(/estadía próxima/)).toBeVisible();
  await settled("removal");
  await page.getByLabel("Escribe «Casa Colibrí» para confirmar").fill("Casa Colibrí");
  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Propiedades eliminadas" })).toBeVisible();
  await settled("removed list");
});

test("guide builder screens have no WCAG A/AA violations (feature 003 T123)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("a11y-guide");
  const page = await newPage(browser);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Accesible");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 222");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Accesible" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: "Guía de Casa Accesible" })).toBeVisible();
  const guide = page.url();
  await expectNoViolations(page, "guide review");

  // The publish dialog open over the review.
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publicar ahora" })).toBeVisible();
  await expectNoViolations(page, "publish dialog");

  await page.getByRole("link", { name: "Llegada y acceso", exact: true }).click();
  await page.getByRole("button", { name: "Agregar texto" }).click();
  await expect(page.getByRole("textbox", { name: "Escribe para tus huéspedes…" })).toBeVisible();
  await expectNoViolations(page, "section editor");

  for (const [suffix, heading] of [
    ["/locked-fields", "Campos protegidos"],
    ["/interview", "Entrevista"],
    ["/uploads", "Manuales y fotos"],
    ["/translations", "Traducciones"],
    ["/versions", "Versiones publicadas"],
    ["/preview", "Vista previa"],
  ] as const) {
    await page.goto(`${guide}${suffix}`);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expectNoViolations(page, suffix);
  }
  await page.goto("/es/shared-content");
  await expect(page.getByRole("heading", { name: "Contenido compartido" })).toBeVisible();
  await expectNoViolations(page, "shared content");
});
