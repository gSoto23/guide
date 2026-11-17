import { readFile } from "node:fs/promises";
import { expect, test, type Browser, type Download, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US5 on a phone viewport (quickstart 10, T106): download the Spanish template,
 * upload a 25-row file saved with semicolons (two invalid rows, one formula cell, one calendar
 * link to a blocked address), see the errors by row and column, download the error file, choose
 * the rows that fit the Free plan, create them, and confirm them. All data is fictional, and the
 * blocked link is refused by the feed reader without leaving the machine.
 */
const FORMULA = '=HYPERLINK("https://evil.example")';
const BLOCKED_LINK = "https://169.254.169.254/latest/calendar.ics";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    locale: "es-CR",
    acceptDownloads: true,
  });
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

async function textOf(download: Download): Promise<string> {
  return readFile((await download.path())!, "utf8");
}

/** Row `fileRow` of the file (the header is row 1): a complete property unless overridden. */
function row(fileRow: number, overrides: Record<number, string> = {}): string[] {
  const cells = [
    `Casa Ficticia ${fileRow}`,
    `Calle Ficticia ${fileRow}`,
    "",
    "Sámara",
    "Guanacaste",
    "50205",
    "Costa Rica",
    "America/Costa_Rica",
    "3 pm",
    "11:00",
    "4",
    "Español, Inglés",
    "",
  ];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return cells;
}

const quote = (cell: string) => (/[;"\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

test("quickstart 10: a CSV with errors, the error file, and the rows that fit", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("us5-owner");
  const page = await newPage(browser);
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") outside.push(url.hostname);
  });
  await page.goto("/es/sign-in");
  await signInWithEmail(page, email);
  await expect(page).toHaveURL(/\/es\/onboarding/);

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Importar un archivo CSV/ }).click();
  await expect(page.getByRole("heading", { name: "Importar un archivo CSV" })).toBeVisible();
  await expect(page.getByText(/No escribas códigos de puertas/)).toBeVisible();

  // The template is in Spanish, with semicolons, instructions, and one example row (FR-037).
  const [templateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar la plantilla" }).click(),
  ]);
  const template = await textOf(templateDownload);
  expect(template.startsWith("\ufeff")).toBe(true);
  const templateLines = template.slice(1).split("\r\n");
  const header = templateLines.find((line) => line.startsWith("Nombre;"))!;
  expect(header).toContain("Nombre;Calle y número;Unidad;Ciudad");
  expect(templateLines.some((line) => /^"?# /.test(line))).toBe(true);

  // A file as a spreadsheet in Spanish saves it: semicolons, accents, byte-order mark.
  const rows = Array.from({ length: 25 }, (_, i) => {
    const fileRow = i + 2;
    if (fileRow === 3) return row(fileRow, { 12: BLOCKED_LINK });
    if (fileRow === 7) return row(fileRow, { 7: "Marte/Olimpo" });
    if (fileRow === 19) return row(fileRow, { 0: FORMULA, 10: "cuatro" });
    return row(fileRow);
  });
  const file = `\ufeff${[header, ...rows.map((cells) => cells.map(quote).join(";"))].join("\r\n")}\r\n`;
  await page.getByLabel("Elegir archivo").setInputFiles({
    name: "propiedades.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(file, "utf8"),
  });
  await expect(page.getByText("Archivo: propiedades.csv")).toBeVisible();
  await page.getByRole("button", { name: "Revisar el archivo" }).click();

  // Every row is checked before anything is created (FR-039).
  await expect(page.getByRole("heading", { name: "Revisa el archivo" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("23 filas se pueden crear · 2 con errores")).toBeVisible();
  const errorList = page.getByRole("region", { name: "Filas con errores" });
  await expect(errorList.getByText("Fila 7 · Casa Ficticia 7")).toBeVisible();
  await expect(errorList.getByText("Zona horaria: zona horaria no reconocida")).toBeVisible();
  await expect(errorList.getByText(`Fila 19 · ${FORMULA}`)).toBeVisible();
  await expect(
    errorList.getByText("Máximo de huéspedes: usa un número entero del 1 al 50"),
  ).toBeVisible();

  // The error file neutralizes the formula and leaves calendar links empty (AC-SEC-006).
  const [errorDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar el archivo de errores" }).click(),
  ]);
  const errorFile = await textOf(errorDownload);
  expect(errorFile).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
  expect(errorFile).not.toMatch(/(^|[;\n])=HYPERLINK/);
  expect(errorFile).not.toContain("169.254.169.254");
  const errorLines = errorFile.slice(1).split("\r\n").filter(Boolean);
  const errorHeader = errorLines.findIndex((line) => line.startsWith("Fila;Errores;Nombre;"));
  expect(errorLines.slice(errorHeader + 1).map((line) => line.split(";")[0])).toEqual([
    "7",
    "19",
  ]);

  // The Free plan has 2 slots: the host chooses which rows to create (US5 scenario 5).
  await expect(page.getByRole("heading", { name: "Elige qué filas crear" })).toBeVisible();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "Fila 2 · Casa Ficticia 2" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Fila 3 · Casa Ficticia 3" })).toBeChecked();
  await page.getByRole("button", { name: "Crear 2 propiedades" }).click();

  // The run page shows the result; the blocked link is an error on its row only (FR-042).
  await expect(page).toHaveURL(/\/es\/properties\/imports\//);
  await expect(page.getByText("La importación terminó")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^Creada$/)).toHaveCount(2);
  await expect(
    page.getByText(
      "Enlace del calendario (iCal): no pudimos leer este calendario, agrégalo desde la propiedad",
    ),
  ).toBeVisible();
  await waitForSubject(email, "Terminó tu importación desde CSV");

  // "Confirm all" moves them to ready (FR-004).
  await page.goto("/es/properties");
  await expect(page.getByText("De un archivo CSV").first()).toBeVisible();
  await page.getByRole("button", { name: "Confirmar todas" }).click();
  await expect(page.getByText("2 propiedades confirmadas.")).toBeVisible();
  expect(outside, "requests outside Guidesk").toEqual([]);
});
