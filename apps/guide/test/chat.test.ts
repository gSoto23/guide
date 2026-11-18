import { describe, expect, it } from "vitest";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/**
 * The chat's entry on guide pages (feature 005 US1, T016): an Ask button hidden until the page
 * script runs, pointing at the chat's own script and styles, and the chat texts in the page's
 * JSON data block with their placeholders left for the script.
 */
async function page(path: string): Promise<string> {
  return (await fixtureHandler()(get(path))).text();
}

function texts(html: string): Record<string, string> {
  const match = /<script type="application\/json" id="guest-texts">([^<]*)<\/script>/.exec(html);
  return JSON.parse(match?.[1] ?? "{}") as Record<string, string>;
}

describe("chat entry (feature 005 FR-001, FR-002)", () => {
  it("adds a hidden Ask button to every guide page, loading the chat only on demand", async () => {
    for (const path of [`/g/${FIXTURE_PUBLIC_ID}/es`, `/g/${FIXTURE_PUBLIC_ID}/es/emergency`]) {
      const html = await page(path);
      expect(html).toContain(
        '<button type="button" id="ask" class="ask" hidden="" data-chat-script="/assets/chat.test.js" data-chat-style="/assets/chat.test.css">Preguntar</button>',
      );
      // Only the page script loads up front; the chat's files are not linked.
      expect(html).not.toContain('src="/assets/chat.test.js"');
      expect(html).not.toContain('href="/assets/chat.test.css"');
    }
  });

  it("has no Ask button outside a guide", async () => {
    expect(await page("/")).not.toContain('id="ask"');
    expect(await page("/g/aaaaaaaaaaaaaaaaaaaaaaaaaa/es")).not.toContain('id="ask"');
  });

  it("ships the chat texts in the page data, in the page's language", async () => {
    const es = texts(await page(`/g/${FIXTURE_PUBLIC_ID}/es`));
    expect(es["chat.title"]).toBe("Pregunta sobre {property}");
    expect(es["chat.intro"]).toContain("{host}");
    expect(es["chat.introPlatform"]).toContain("plataforma de tu reserva");
    expect(es["chat.paused"]).toContain("{minutes}");
    expect(es["chat.suggestions.checkout"]).toBe("¿A qué hora es la salida?");
    const en = texts(await page(`/g/${FIXTURE_PUBLIC_ID}/en`));
    expect(en["chat.send"]).toBe("Send");
    expect(en["chat.counter"]).toBe("{count} of 2,000 characters");
  });
});
