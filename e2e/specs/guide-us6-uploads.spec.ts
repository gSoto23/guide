import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US6 (quickstart 7, T107), with the fake model: a PDF manual is read, deleted, and
 * turned into a suggestion labeled with the file name in Appliances; it is accepted, and another
 * discarded. An encrypted PDF is rejected with its reason, and a file that is not an image never
 * leaves the device. Scanned PDFs (behind their flag) and photos read for text are covered by the
 * sandbox and worker tests. Every PDF is built by the test from synthetic text.
 */
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

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A one-page PDF with lines of Helvetica text; `encrypted` adds a password it cannot open. */
function pdf(lines: string[], encrypted = false): Buffer {
  const stream = lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 16} Td (${escapePdf(line)}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >> /Contents 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Catalog /Pages 4 0 R >>",
    ...(encrypted
      ? [`<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -44 >>`]
      : []),
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  const extra = encrypted ? ` /Encrypt 6 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]` : "";
  body += `trailer\n<< /Size ${objects.length + 1} /Root 5 0 R${extra} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

test("quickstart 7: a manual becomes suggestions; bad files are refused", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("guide-us6"));

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Manatí");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 987");
  await page.getByLabel(/^Ciudad/).fill("Cahuita");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Manatí" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: "Guía de Casa Manatí" })).toBeVisible();
  await page.getByRole("link", { name: "Manuales y fotos" }).click();
  await expect(page.getByRole("heading", { name: "Manuales y fotos" })).toBeVisible();
  await expect(page.getByText(/No subas fotos de códigos ni contraseñas/)).toBeVisible();

  // A manual and an encrypted PDF.
  await page.locator('input[type="file"][multiple]').setInputFiles([
    {
      name: "manual-lavadora.pdf",
      mimeType: "application/pdf",
      buffer: pdf(["La lavadora usa el programa corto para las toallas de playa."]),
    },
    {
      name: "manual-con-clave.pdf",
      mimeType: "application/pdf",
      buffer: pdf(["Contenido protegido."], true),
    },
  ]);
  const manual = page.getByRole("listitem").filter({ hasText: "manual-lavadora.pdf" });
  await expect(manual.getByText(/Listo: 1 sugerencia por revisar/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(manual.getByText("Electrodomésticos y cómo usarlos")).toBeVisible();
  await expect(manual.getByText(/programa corto para las toallas/)).toBeVisible();
  const locked = page.getByRole("listitem").filter({ hasText: "manual-con-clave.pdf" });
  await expect(locked.getByText(/El PDF tiene contraseña/)).toBeVisible({ timeout: 90_000 });

  // Accept the suggestion: it leaves the list and stays in the section, reviewed.
  await manual.getByRole("button", { name: "Aceptar" }).click();
  await expect(manual.getByText(/^Listo$/)).toBeVisible();
  await page.getByRole("link", { name: "Volver a la guía" }).click();
  await page.getByRole("link", { name: "Electrodomésticos y cómo usarlos", exact: true }).click();
  await expect(page.getByText(/programa corto para las toallas/)).toBeVisible();
  await expect(page.getByText(/De tu archivo|Revisado/).first()).toBeVisible();

  // A second manual: its suggestion is discarded.
  await page.goto(page.url().replace(/\/sections\/.*$/, "/uploads"));
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "manual-secadora.pdf",
    mimeType: "application/pdf",
    buffer: pdf(["La secadora se limpia quitando el filtro de pelusa después de cada uso."]),
  });
  const dryer = page.getByRole("listitem").filter({ hasText: "manual-secadora.pdf" });
  await expect(dryer.getByText(/Listo: 1 sugerencia por revisar/)).toBeVisible({ timeout: 90_000 });
  await dryer.getByRole("button", { name: "Descartar" }).click();
  await expect(dryer.getByText(/^Listo$/)).toBeVisible();
  await expect(page.getByText(/filtro de pelusa/)).toHaveCount(0);

  // A file that is not an image never leaves the device (AC-SEC-009).
  await page.locator('input[type="file"][multiple]').setInputFiles({
    name: "foto-falsa.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(64)]),
  });
  await expect(page.getByText(/No pudimos abrir la foto foto-falsa.jpg/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "foto-falsa.jpg" })).toHaveCount(0);
});
