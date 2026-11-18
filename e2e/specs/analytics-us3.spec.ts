import { expect, test } from "@playwright/test";
import {
  openChat,
  propertyLink,
  publishGuide,
  sendChatMessage,
  setAutonomy,
  signIn,
  uniqueEmail,
} from "../helpers/guest";

/**
 * Feature 010 US3 (quickstart 3, T015): with two properties, the workspace Analytics shows totals and
 * a row per property; sorting is announced; a row opens the property's Analytics. Fake model.
 */
test("quickstart 3: compare properties", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await signIn(page, uniqueEmail("analytics-us3"));
  const casa = await publishGuide(page);
  await publishGuide(page, { name: "Villa Mar" });
  await setAutonomy(page, casa, "auto");

  const context = await browser.newContext({ locale: "es-CR", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(await propertyLink(page, casa));
  await openChat(guest);
  await sendChatMessage(guest, "¿Cómo abro la caja de llaves?");
  await expect(guest.getByRole("dialog").locator(".chat-msg-assistant").last()).toContainText(
    "Abre la caja de llaves",
    { timeout: 15_000 },
  );
  await context.close();

  await page.goto("/es/inbox");
  await page.getByRole("navigation", { name: "Guidesk" }).getByRole("link", { name: "Estadísticas" }).click();
  await expect(
    page.getByRole("heading", { name: "Estadísticas: todas las propiedades", level: 1 }),
  ).toBeVisible();
  const table = page.getByRole("table", { name: "Propiedades en este periodo" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(page
      .locator(".metric")
      .filter({ has: page.locator(".metric-label").getByText("Preguntas de huéspedes", { exact: true }) }).locator(".metric-value")).toHaveText("1");

  await table.getByRole("button", { name: "Preguntas" }).click();
  await expect(table.getByRole("columnheader", { name: "Preguntas" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(page.getByText("Ordenado por Preguntas, descendente")).toBeAttached();
  await expect(table.getByRole("row").nth(1)).toContainText("Casa Colibrí");
  await table.getByRole("button", { name: "Preguntas" }).click();
  await expect(table.getByRole("row").nth(1)).toContainText("Villa Mar");

  await table.getByRole("link", { name: "Casa Colibrí" }).click();
  await expect(page.getByRole("heading", { name: "Estadísticas: Casa Colibrí", level: 1 })).toBeVisible();
});
