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

test("guest guide and Share screens have no WCAG A/AA violations (feature 004 T067)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { addStay, publishGuide, signIn } = await import("../helpers/guest");
  const host = await newPage(browser);
  await signIn(host, uniqueEmail("a11y-guest"));
  const guide = await publishGuide(host);
  const stay = await addStay(host, guide, 0);
  await host.request.patch(`${guide.base}/share/settings`, {
    data: { requireConfirmationCode: true },
  });

  await host.goto(`/es/properties/${guide.propertyId}/share`);
  await expect(host.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    host.getByRole("heading", { name: "Estadías: enlaces que muestran los códigos" }),
  ).toBeVisible();
  await expectNoViolations(host, "share screen");
  await host.goto(`/es/properties/${guide.propertyId}/share/poster`);
  await expect(host.getByRole("heading", { name: "Casa Colibrí" })).toBeVisible();
  await expectNoViolations(host, "poster");

  const copied = await host.request.post(`${guide.base}/share/stays/${stay.id}/link`, { data: {} });
  const { url } = (await copied.json()) as { url: string };
  for (const locale of ["es-CR", "en-US"]) {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    const guest = await context.newPage();
    await guest.goto(url);
    await expect(guest).toHaveURL(/\/g\/[a-z2-7]{26}\/(es|en)$/);
    await expect(guest.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(guest, `guest home (${locale})`);
    await guest.locator(".tile").first().click();
    await expect(guest.locator(".locked-show").first()).toBeVisible();
    await expectNoViolations(guest, `arrival with a locked field (${locale})`);
    await guest.locator(".locked-show").first().click();
    await expect(guest.getByRole("dialog")).toBeVisible();
    await expectNoViolations(guest, `confirmation form (${locale})`);
    await guest.goto(guest.url().replace(/\/[0-9a-f-]{36}$/, "/emergency"));
    await expectNoViolations(guest, `emergency (${locale})`);
    await guest.goto(`${new URL(url).origin}/g/abcdefghijklmnopqrstuvwxyz/en`);
    await expectNoViolations(guest, `unavailable (${locale})`);
    await context.close();
  }
});

test("guide chat and conversation screens have no WCAG A/AA violations (feature 005 T046)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { openChat, propertyLink, publishGuide, sendChatMessage, signIn } =
    await import("../helpers/guest");
  const host = await newPage(browser);
  await signIn(host, uniqueEmail("a11y-chat"));
  const guide = await publishGuide(host);
  const link = await propertyLink(host, guide);

  for (const locale of ["es-CR", "en-US"]) {
    const context = await browser.newContext({ locale, viewport: { width: 390, height: 844 } });
    const guest = await context.newPage();
    await guest.goto(link);
    await openChat(guest);
    await expectNoViolations(guest, `chat intro (${locale})`);
    await sendChatMessage(
      guest,
      locale === "es-CR" ? "Hay humo en la cocina" : "How do I open the lockbox?",
    );
    await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toBeVisible({
      timeout: 15_000,
    });
    await expectNoViolations(guest, `chat with replies (${locale})`);
    await context.close();
  }

  await host.goto(`/es/properties/${guide.propertyId}/conversations`);
  await expect(host.getByRole("link", { name: "Abrir conversación" }).first()).toBeVisible();
  await expectNoViolations(host, "conversation list");
  await host.getByRole("link", { name: "Abrir conversación" }).first().click();
  await expect(host.getByRole("heading", { name: "Conversación" })).toBeVisible();
  await expectNoViolations(host, "conversation page");
  await host.goto(`/es/properties/${guide.propertyId}`);
  await expect(host.getByRole("heading", { name: "Asistente del chat" })).toBeVisible();
  await expectNoViolations(host, "property page with the assistant card");
});

test("assistant settings screens have no WCAG A/AA violations (feature 007 T047)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { publishGuide, signIn } = await import("../helpers/guest");
  const host = await newPage(browser);
  await signIn(host, uniqueEmail("a11y-settings"));
  const guide = await publishGuide(host);

  await host.goto("/es/settings/assistant");
  await expect(host.getByRole("heading", { name: "Asistente del chat", level: 1 })).toBeVisible();
  await host.getByLabel("Activar horas de silencio").check();
  await host.getByRole("radio", { name: "Solo a estas personas" }).check();
  await expectNoViolations(host, "workspace assistant settings");

  await host.goto(`/en/properties/${guide.propertyId}/assistant`);
  await expect(host.getByRole("heading", { name: "This property's assistant" })).toBeVisible();
  await host
    .locator("section.card", { hasText: "When it answers on its own" })
    .getByLabel("Use the workspace settings")
    .uncheck();
  const panel = host.locator("section.card", { hasText: "Test the assistant" });
  await panel.getByLabel("Question").fill("How do I open the lockbox?");
  await panel.getByRole("button", { name: "Test" }).click();
  await expect(panel.getByText(/^Result:/)).toBeVisible({ timeout: 20_000 });
  await expectNoViolations(host, "property assistant settings with a test result");
});

test("inbox, conversation actions, copilot, and alerts screens have no WCAG A/AA violations (feature 006 T039)", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const { openChat, propertyLink, publishGuide, sendChatMessage, signIn } =
    await import("../helpers/guest");
  const host = await newPage(browser);
  await signIn(host, uniqueEmail("a11y-inbox"));
  const guide = await publishGuide(host);

  await host.goto("/es/inbox");
  await expect(host.getByRole("heading", { name: "Bandeja", level: 1 })).toBeVisible();
  await expectNoViolations(host, "empty inbox");

  const context = await browser.newContext({
    locale: "es-CR",
    viewport: { width: 390, height: 844 },
  });
  const guest = await context.newPage();
  await guest.goto(await propertyLink(host, guide));
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toBeVisible({
    timeout: 15_000,
  });
  await context.close();

  await host.goto("/es/inbox");
  await expect(host.locator(".inbox-item").first()).toBeVisible({ timeout: 20_000 });
  await expectNoViolations(host, "inbox with a conversation");
  await host.getByRole("tab", { name: "Todas" }).click();
  await expectNoViolations(host, "inbox, all tab");

  await host.locator(".inbox-item").first().getByRole("link").click();
  await expect(host.getByRole("button", { name: "Descartar borrador" })).toBeVisible();
  await expectNoViolations(host, "conversation with draft actions");
  await host.getByLabel("Responderé yo").check();
  await expect(host.getByText(/^La tomó /)).toBeVisible();
  await expectNoViolations(host, "taken-over conversation");

  await host.goto("/es/inbox/copilot");
  await host.getByLabel("Mensaje del huésped").fill("¿A qué hora es la salida?");
  await expectNoViolations(host, "copilot form");
  await host.getByRole("button", { name: "Preparar respuesta" }).click();
  await expect(host.locator(".copilot-result")).toBeVisible({ timeout: 20_000 });
  await expectNoViolations(host, "copilot with a draft");

  await host.goto("/es/settings/account");
  await expect(host.getByRole("heading", { name: "Alertas en este dispositivo" })).toBeVisible();
  await expectNoViolations(host, "account settings with the alerts card");

  await host.goto("/en/inbox");
  await expect(host.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expectNoViolations(host, "inbox (en)");
});
