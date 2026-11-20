import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuestExtra, GuestExtras } from "@guidesk/contracts";
import { fixtureExtras, fixtureGuide } from "../src/fixtures/guide.js";
import { translator } from "../src/i18n.js";
import { ExtraPage, ExtrasPage, extrasTexts } from "../src/pages/extras-pages.js";
import { HomePage } from "../src/pages/guide-pages.js";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/**
 * Extras pages (feature 008 T011, T013): the list with prices or "Free", "Offered by your host"
 * and the optional note; one extra with its rules and a form the page script shows only to a stay's
 * guest; host text as text; the home tile only with visible extras; and the script's texts for
 * every status, reason, rule, and error. Synthetic data only.
 */
const assets = {
  script: "/a.js",
  style: "/a.css",
  chatScript: "/c.js",
  chatStyle: "/c.css",
  publicDir: "/tmp",
};

function input(language: "es" | "en", extras: GuestExtras) {
  return {
    t: translator(language),
    locale: language,
    assets,
    guide: fixtureGuide(FIXTURE_PUBLIC_ID, language)!,
    extras,
  };
}

const hostile: GuestExtra = {
  id: "00000000-0000-4000-8000-0000000000e9",
  name: '<img src=x onerror="alert(1)">Tour',
  description: '<script>alert(1)</script> <a href="https://evil.example">x</a>',
  language: "es",
  price: 12.5,
  currency: "USD",
  leadTimeHours: 1,
  needsDate: true,
  needsTime: true,
  dateRange: "stay",
  weekdays: [1, 3, 5],
  maxPerStay: 3,
  turnover: null,
  image: null,
};

const textsOf = (html: string): Record<string, string> => {
  const match = /<script type="application\/json" id="guest-texts">(.*?)<\/script>/.exec(html);
  return JSON.parse(match![1]!) as Record<string, string>;
};

describe("Extras list (feature 008 US2, FR-007)", () => {
  it("lists names, prices or Free, a short description, and Offered by your host", () => {
    const extras = fixtureExtras(FIXTURE_PUBLIC_ID, "es")!;
    const html = renderToString(<ExtrasPage {...input("es", extras)} />);
    expect(html).toContain('data-extras-page="list"');
    expect(html).toContain("Recogida en el aeropuerto");
    expect(html).toMatch(/USD\s85/);
    expect(html).toContain("Gratis");
    expect(html).toMatch(/₡\s?15\s?000/);
    expect(html.split("Ofrecido por tu anfitrión").length - 1).toBe(extras.extras.length);
    expect(html).toContain("Los servicios extra son opcionales. En la guía no se cobra nada");
    expect(html).toContain(
      `href="/g/${FIXTURE_PUBLIC_ID}/es/extras/00000000-0000-4000-8000-0000000000e1"`,
    );
    // The stay's requests are filled by the script, never rendered in cached HTML.
    expect(html).toMatch(/<section[^>]*data-extra-requests="true"[^>]*hidden=""/);
  });

  it("shortens long descriptions and says when there are none", () => {
    const long = { ...hostile, name: "Tour", description: `${"palabra ".repeat(40)}final` };
    const html = renderToString(<ExtrasPage {...input("es", { extras: [long] })} />);
    expect(html).toContain("…");
    expect(html).not.toContain("final");
    const empty = renderToString(<ExtrasPage {...input("en", { extras: [] })} />);
    expect(empty).toContain("There are no extra services for now.");
  });
});

describe("One extra (feature 008 US2, FR-008, FR-010, FR-014)", () => {
  it("renders host text as text, its rules, and the request form hidden behind the stay note", () => {
    const html = renderToString(
      <ExtraPage {...input("en", { extras: [hostile] })} extra={hostile} />,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain("&lt;script&gt;");
    // A Spanish-only extra on the English page says so and marks the language.
    expect(html).toContain("Text available in Spanish only.");
    expect(html).toMatch(/<h1[^>]*lang="es"/);
    expect(html).toContain("For a day of your stay.");
    expect(html).toContain("Only on Monday, Wednesday, and Friday.");
    expect(html).toContain("Request it at least 1 hour ahead.");
    expect(html).toContain("Up to 3 per stay.");
    expect(html).toContain("$12.50");
    // Without a stay session: the note on how to request, no visible form.
    expect(html).toContain("To request it, open the guide from the stay link your host sent you.");
    expect(html).toMatch(/<form[^>]*data-request-form="true"[^>]*hidden=""/);
    // Labelled fields, the note's hint tied to it, and a live region for errors.
    expect(html).toMatch(/<label[^>]*for="extra-date"/);
    expect(html).toMatch(/<input[^>]*id="extra-date"[^>]*type="date"[^>]*required/);
    expect(html).toMatch(/<label[^>]*for="extra-time"/);
    expect(html).toMatch(/<input[^>]*id="extra-quantity"[^>]*max="3"/);
    expect(html).toMatch(/<textarea[^>]*maxLength="300"[^>]*aria-describedby="extra-note-hint"/i);
    expect(html).toContain("Don&#x27;t include phone numbers, emails, or documents.");
    expect(html).toMatch(/role="alert"[^>]*data-request-error/);
    expect(html).toContain('data-lead="1"');
  });

  it("asks only for what the extra needs: no date for late checkout, no quantity for one", () => {
    const late = fixtureExtras(FIXTURE_PUBLIC_ID, "es")!.extras[2]!;
    const html = renderToString(<ExtraPage {...input("es", { extras: [late] })} extra={late} />);
    expect(html).not.toContain('id="extra-date"');
    expect(html).not.toContain('id="extra-time"');
    expect(html).not.toContain('id="extra-quantity"');
    expect(html).toContain("Para el día de tu salida, si nadie llega a la casa ese día.");
    expect(html).toContain("Pídelo con al menos 12 horas de anticipación.");
    expect(html).toContain("Uno por estadía.");
  });

  it("gives the script a text for every status, reason, rule, and error in both languages", () => {
    for (const language of ["es", "en"] as const) {
      const texts = extrasTexts(translator(language));
      for (const status of [
        "waiting",
        "confirmed",
        "declined",
        "cancelled",
        "host_cancelled",
        "expired",
      ]) {
        expect(texts[`extras.status.${status}`]).toBeTruthy();
      }
      for (const reason of ["unavailable", "fully_booked", "too_late", "other", "stay"]) {
        expect(texts[`extras.reasons.${reason}`]).toBeTruthy();
      }
      for (const rule of [
        "quantity",
        "needs_date",
        "needs_time",
        "date_range",
        "weekday",
        "lead_time",
        "max_per_stay",
        "turnover",
      ]) {
        expect(texts[`extras.rules.${rule}`]).toBeTruthy();
      }
      for (const blocked of ["no_session", "ended", "verify"]) {
        expect(texts[`extras.blocked.${blocked}`]).toBeTruthy();
      }
      expect(texts["extras.rules.lead_time"]).toContain("{hours}");
      expect(texts["verify.title"]).toBeTruthy();
      for (const value of Object.values(texts)) expect(value).not.toMatch(/^extras\./);
    }
    const texts = extrasTexts(translator("es"));
    expect(texts["extras.status.waiting"]).toBe("Esperando a tu anfitrión");
    expect(texts["extras.status.confirmed"]).toBe(
      "Confirmada: tu anfitrión acordará el pago contigo",
    );
    expect(texts["extras.statusNote.declined"]).toBe("No se cobró nada.");
  });
});

describe("Extras through the router (feature 008 research R6)", () => {
  it("serves the list and a detail, redirects unknown extras, and shows the home tile", async () => {
    const handle = fixtureHandler();
    const list = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en/extras`));
    expect(list.status).toBe(200);
    expect(list.headers.get("cache-control")).toContain("s-maxage=60");
    const listHtml = await list.text();
    expect(listHtml).toContain("Airport pickup");
    expect(textsOf(listHtml)["extras.status.waiting"]).toBe("Waiting for your host");
    const detail = await handle(
      get(`/g/${FIXTURE_PUBLIC_ID}/en/extras/00000000-0000-4000-8000-0000000000e1`),
    );
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain('data-extra-id="00000000-0000-4000-8000-0000000000e1"');
    for (const missing of ["00000000-0000-4000-8000-0000000000ff", "not-a-uuid"]) {
      const response = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en/extras/${missing}`));
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`/g/${FIXTURE_PUBLIC_ID}/en/extras`);
    }
    const home = await (await handle(get(`/g/${FIXTURE_PUBLIC_ID}/es`))).text();
    expect(home).toContain(`href="/g/${FIXTURE_PUBLIC_ID}/es/extras"`);
    expect(home).toContain("Servicios extra");
  });

  it("has no Extras tile when the property has no visible extras", () => {
    const guide = { ...fixtureGuide(FIXTURE_PUBLIC_ID, "es")!, extras: { visible: false } };
    const html = renderToString(
      <HomePage t={translator("es")} locale="es" assets={assets} guide={guide} />,
    );
    expect(html).not.toContain("/extras");
    expect(html).not.toContain("Servicios extra");
  });
});
