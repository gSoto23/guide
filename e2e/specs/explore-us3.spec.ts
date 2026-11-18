import { expect, test } from "@playwright/test";
import { propertyLink, publishGuide, signIn, uniqueEmail } from "../helpers/guest";

/**
 * Feature 009 US3 (quickstart 3, T020): the disclosure in both languages, and click addresses that
 * never lead anywhere but a stored partner page. Synthetic partner data.
 */
test("quickstart 3: disclosures and safe links", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await signIn(page, uniqueEmail("explore-us3"));
  const guide = await publishGuide(page);
  const link = await propertyLink(page, guide);
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
  const guest = await context.newPage();
  await guest.goto(link);
  const english = new URL(guest.url());
  await guest.goto(`${english.origin}${english.pathname.replace(/\/(es|en)$/, "/en")}/explore`);
  await expect(guest.getByRole("heading", { name: "Experiences near Sámara" })).toBeVisible({
    timeout: 20_000,
  });
  const cards = await guest.locator(".experience").count();
  await expect(
    guest.getByText("Guidesk may earn a commission if you book, at no extra cost to you."),
  ).toHaveCount(cards + 1);

  const publicId = english.pathname.split("/")[2]!;
  const go = (path: string) =>
    guest.request.get(`${english.origin}/api/v1/guest/guides/${publicId}/experiences/${path}`, {
      maxRedirects: 0,
    });
  for (const path of [
    "viator-NOTSHOWN/go?lang=en",
    "other-1/go?lang=en",
    "viator-x%2F..%2Fy/go?lang=en",
  ]) {
    const response = await go(path);
    expect(response.status(), path).toBe(302);
    expect(response.headers().location, path).toBe(`/g/${publicId}/en/explore`);
  }
  const firstRef = (await guest.locator(".experience a").first().getAttribute("href"))!.split("/").pop()!;
  const extra = await go(`${firstRef}/go?lang=en&url=https%3A%2F%2Fevil.example%2F`);
  expect(extra.headers().location).toMatch(/^https:\/\/www\.viator\.com\//);
  await context.close();
});
