import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US4 (quickstart 5, T084), with the fake model and fake speech: the interview asks
 * the heaviest missing topic first, drafts a typed answer into the right section, sends code
 * topics to the locked fields, drafts a voice note recorded from a fixture media stream
 * (FR-037), keeps a typed code out of the draft (AC-SEC-004), and leaves every draft for review.
 * Needs GUIDE_INTERVIEW_VOICE=true on the local API. All data is fictional.
 */
/**
 * A fixture media stream: a 440 Hz tone from Web Audio stands in for the microphone, so the
 * browser's real `MediaRecorder` records a real WebM file without a device or a system prompt.
 */
async function useFixtureMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      tone.frequency.value = 440;
      tone.connect(destination);
      tone.start();
      return destination.stream;
    };
  });
}

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signIn(page: Page, email: string) {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
}

async function answer(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Tu respuesta" }).fill(text);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
}

test("quickstart 5: the interview by text and voice, with codes kept out", async ({ page }) => {
  test.setTimeout(240_000);
  await useFixtureMicrophone(page);
  await signIn(page, uniqueEmail("guide-us4"));

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Tortuga");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 321");
  await page.getByLabel(/^Ciudad/).fill("Puerto Viejo");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Tortuga" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: "Guía de Casa Tortuga" })).toBeVisible();
  const guideUrl = page.url();

  // The heaviest missing topic first (FR-034): how to get in.
  await page.getByRole("link", { name: "Empezar la entrevista" }).click();
  await expect(page.getByRole("heading", { name: "Entrevista" })).toBeVisible();
  await expect(page.getByText("Para la sección Llegada y acceso")).toBeVisible();
  await expect(page.getByText(/No incluyas códigos ni contraseñas/)).toBeVisible();
  await answer(page, "Al llegar, abran el portón con el control que está en el buzón.");
  await expect(page.getByText(/Agregamos 1 texto a Llegada y acceso/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Al llegar, abran el portón con el control que está en el buzón."),
  ).toBeVisible();

  // A code topic opens the locked fields instead of asking (FR-038).
  await expect(page.getByText(/Esta respuesta es un código/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Abrir los campos protegidos/ })).toBeVisible();
  await page.getByRole("button", { name: "Saltar" }).click();

  // A voice note from the fixture stream, transcribed by the fake speech (FR-037).
  await expect(page.getByText("Para la sección Electrodomésticos y cómo usarlos")).toBeVisible();
  await page.getByRole("button", { name: /Grabar nota de voz/ }).click();
  await expect(page.getByText(/Grabando…/)).toBeVisible();
  await page.waitForTimeout(2_500);
  await page.getByRole("button", { name: "Detener" }).click();
  await expect(page.getByText("Lo que entendimos")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Agregamos 1 texto a Electrodomésticos/)).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText(/control remoto que está en la mesa de noche/).first()).toBeVisible();

  // A typed code never reaches the draft (AC-SEC-004).
  await expect(page.getByText("Para la sección Emergencias y contactos")).toBeVisible();
  await answer(
    page,
    "Llamen a Marta, la vecina de la casa azul. La alarma se apaga con el código 4821.",
  );
  await expect(page.getByText(/Quitamos un código de tu respuesta/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/Agregamos 1 texto a Emergencias/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/4821/)).toHaveCount(0);

  await page.getByRole("button", { name: "Terminar" }).click();
  await expect(page.getByText("Terminaste la entrevista.")).toBeVisible();

  // Drafts wait for review, labeled with their source (FR-005).
  await page.goto(guideUrl);
  await page.getByRole("link", { name: "Electrodomésticos y cómo usarlos", exact: true }).click();
  await expect(page.getByText("De tu entrevista · Por revisar").first()).toBeVisible();
});
