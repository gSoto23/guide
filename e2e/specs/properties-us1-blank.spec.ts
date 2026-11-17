import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, latestMessageTo, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US1 on a phone viewport (quickstart scenarios 1 and 2, T037): a blank property with
 * the suggested time zone, choosing among Mexico's zones, the agent's read-only view, and the
 * limit explanation. All data is fictional.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

async function signInWithEmail(page: Page, email: string) {
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

/** Fills the confirmation step for a property in Sámara, Costa Rica. */
async function fillCostaRica(page: Page, name: string) {
  await page.getByLabel(/^Nombre de la propiedad/).fill(name);
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  // Costa Rica has one zone: it is suggested without any outside request (FR-002).
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
}

test("quickstart 1 and 2: blank property, zone choice, agent view, and the limit", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const ownerEmail = uniqueEmail("us1-owner");
  const owner = await newPage(browser);
  const outside: string[] = [];
  owner.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") outside.push(url.hostname);
  });
  await owner.goto("/es/sign-in");
  await signInWithEmail(owner, ownerEmail);
  await expect(owner).toHaveURL(/\/es\/onboarding/);

  // No properties yet: the list shows the starting options, and Blank leads to the form.
  await owner.goto("/es/properties");
  await expect(owner.getByRole("heading", { name: "Crea tu primera propiedad" })).toBeVisible();
  await owner.getByRole("link", { name: /Empezar desde cero/ }).click();
  await expect(
    owner.getByRole("heading", { name: "Confirma los datos de la propiedad" }),
  ).toBeVisible();

  // Mexico has several zones: an unknown city shows the choices; Cancún is recognized.
  await owner.getByLabel(/^País/).selectOption("MX");
  await owner.getByLabel(/^Ciudad/).fill("Ciudad Inventada");
  await expect(owner.getByText("Este país tiene varias zonas horarias")).toBeVisible();
  await expect(owner.getByLabel(/^Zona horaria/)).toHaveValue("");
  await owner.getByLabel(/^Ciudad/).fill("Cancún");
  await expect(owner.getByLabel(/^Zona horaria/)).toHaveValue("America/Cancun");

  await fillCostaRica(owner, "Casa Colibrí");
  await owner.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(owner.getByRole("heading", { name: "Casa Colibrí" })).toBeVisible();
  await expect(owner.getByText("Lista para la guía")).toBeVisible();
  expect(outside, "requests outside Guidesk").toEqual([]);

  // The owner changes the checkout time; times stay in the property's zone.
  await owner.getByRole("button", { name: "Editar datos" }).click();
  await owner.getByLabel(/^Hora de salida/).fill("10:30");
  await owner.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(owner.getByText(/Salida 10:30 \(America\/Costa_Rica\)/)).toBeVisible();
  const propertyUrl = owner.url();

  // An agent of the same workspace views it, without edit controls.
  const agentEmail = uniqueEmail("us1-agent");
  await owner.goto("/es/settings/members");
  await owner.getByLabel("Email", { exact: true }).fill(agentEmail);
  await owner.getByRole("radio", { name: /Agente/ }).check();
  await owner.getByRole("button", { name: "Enviar invitación" }).click();
  const { text } = await latestMessageTo(agentEmail);
  const invitePath = text.match(/\/es\/invite\/[A-Za-z0-9_-]{43}/)?.[0] ?? "";
  const agent = await newPage(browser);
  await agent.goto(invitePath);
  await agent.getByRole("button", { name: "Continuar" }).click();
  await signInWithEmail(agent, agentEmail);
  await agent.getByRole("button", { name: "Aceptar invitación" }).click();
  await expect(agent.getByText(/Ya formas parte de/)).toBeVisible();
  await agent.goto(propertyUrl);
  await expect(agent.getByRole("heading", { name: "Casa Colibrí" })).toBeVisible();
  await expect(agent.getByText("Puedes ver esta propiedad")).toBeVisible();
  await expect(agent.getByRole("button", { name: "Editar datos" })).toHaveCount(0);

  // A second property reaches the Free plan's limit of 2, and the list explains it.
  await owner.goto("/es/properties/new/blank");
  await fillCostaRica(owner, "Casa Búho");
  await owner.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(owner.getByRole("heading", { name: "Casa Búho" })).toBeVisible();
  await owner.goto("/es/properties");
  await expect(owner.getByText("2 de 2 propiedades")).toBeVisible();
  await expect(owner.getByText(/Llegaste al límite de 2 propiedades/)).toBeVisible();
});
