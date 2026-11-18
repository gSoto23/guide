import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "./mailpit";

/**
 * Feature 004 end-to-end helpers: a signed-in owner, a guide published through the API (faster
 * and steadier than clicking through feature 003's editor), and the guest app's address. All data
 * is fictional.
 */
export const GUIDE_URL = process.env.GUIDE_URL ?? "http://127.0.0.1:3001";
export const LOCKBOX = "846251";
export const WIFI_PASSWORD = "PalmeraAzul77";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
}

async function json<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(
    true,
  );
  return (await response.json()) as T;
}

export interface PublishedGuide {
  workspaceId: string;
  propertyId: string;
  lockboxId: string;
  base: string;
}

const paragraph = (...content: object[]) => ({
  type: "doc",
  content: [{ type: "paragraph", content }],
});

/** Publishes a guide with a lockbox code, a Wi-Fi password, and a benefit recommendation. */
export async function publishGuide(
  page: Page,
  options: { name?: string; publicWifi?: boolean } = {},
): Promise<PublishedGuide> {
  const request = page.request;
  const me = await json<{ lastWorkspaceId: string }>(await request.get("/api/v1/me"));
  const ws = `/api/v1/workspaces/${me.lastWorkspaceId}`;
  const property = await json<{ id: string }>(
    await request.post(`${ws}/properties`, {
      data: {
        name: options.name ?? "Casa Colibrí",
        addressLine1: "Calle Ficticia 123",
        city: "Sámara",
        country: "CR",
        timeZone: "America/Costa_Rica",
        checkInTime: "15:00",
        checkoutTime: "11:00",
        maxGuests: 4,
        guideLanguages: ["es", "en"],
      },
    }),
  );
  const base = `${ws}/properties/${property.id}`;
  const field = async (kind: string, label: string, value: string) =>
    (
      await json<{ id: string }>(
        await request.post(`${base}/guide/locked-fields`, { data: { kind, label, value } }),
      )
    ).id;
  const lockboxId = await field("lockbox_code", "Caja de llaves", LOCKBOX);
  const wifiId = await field("wifi_password", "Contraseña del wifi", WIFI_PASSWORD);
  if (options.publicWifi) {
    await json(
      await request.put(`${base}/guide/locked-fields/${wifiId}/visibility`, {
        data: { public: true },
      }),
    );
  }
  const add = async (kind: string, body: object) => {
    const view = await json<{ sections: { id: string; kind: string; revision: number }[] }>(
      await request.get(`${base}/guide`),
    );
    const section = view.sections.find((candidate) => candidate.kind === kind)!;
    await json(
      await request.post(`${base}/guide/sections/${section.id}/items`, {
        data: { revision: section.revision, ...body },
      }),
    );
  };
  await add("arrival", {
    kind: "text",
    language: "es",
    doc: paragraph(
      { type: "text", text: "Abre la caja de llaves con " },
      { type: "lockedField", attrs: { fieldId: lockboxId } },
      { type: "text", text: "." },
    ),
  });
  await add("arrival", {
    kind: "text",
    language: "en",
    doc: paragraph(
      { type: "text", text: "Open the lockbox with " },
      { type: "lockedField", attrs: { fieldId: lockboxId } },
      { type: "text", text: "." },
    ),
  });
  await add("wifi", {
    kind: "text",
    language: "es",
    doc: paragraph(
      { type: "text", text: "Red: CasaColibri. Clave: " },
      { type: "lockedField", attrs: { fieldId: wifiId } },
    ),
  });
  await add("local_recommendations", {
    kind: "recommendation",
    language: "es",
    recommendation: {
      name: "Soda La Palma",
      category: "restaurant",
      url: "https://example.com/soda",
      benefit: "commission",
    },
  });
  const check = await json<{ revisionHash: string }>(
    await request.get(`${base}/guide/publish-check`),
  );
  await json(
    await request.post(`${base}/guide/publish`, {
      data: { expectedRevisionHash: check.revisionHash },
    }),
  );
  return { workspaceId: me.lastWorkspaceId, propertyId: property.id, lockboxId, base };
}

/** Adds a manual stay starting `startOffsetDays` from today (property time zone ≈ UTC−6). */
export async function addStay(
  page: Page,
  guide: PublishedGuide,
  startOffsetDays: number,
  nights = 3,
) {
  const day = (offset: number) => {
    const date = new Date(Date.now() - 6 * 3_600_000);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  return json<{ id: string }>(
    await page.request.post(`${guide.base}/stays`, {
      data: {
        checkInDate: day(startOffsetDays),
        checkoutDate: day(startOffsetDays + nights),
        channel: "Directo",
      },
    }),
  );
}

// Feature 005: the in-guide chat ---------------------------------------------------------------------

/** Sets the workspace's assistant autonomy through the API (owners and admins). */
const TOPICS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "other",
] as const;
type Level = "draft" | "auto" | "full_auto";

interface WorkspaceSettings {
  version: number;
  autonomy: Record<string, Level>;
  tone: "casual" | "formal";
  quietHours: { enabled: boolean; start: string | null; end: string | null };
  contacts: { mode: "all" } | { mode: "selected"; memberIds: string[] };
  instructions: { text: string } | null;
  members: { id: string; name: string; role: string }[];
}

/** Every topic at one level (feature 007 research R1). */
export const allTopics = (level: Level): Record<string, Level> =>
  Object.fromEntries(TOPICS.map((topic) => [topic, level]));

/** Reads the workspace's assistant settings (feature 007 contracts). */
export async function assistantSettings(
  page: Page,
  guide: PublishedGuide,
): Promise<WorkspaceSettings> {
  return json<WorkspaceSettings>(
    await page.request.get(`/api/v1/workspaces/${guide.workspaceId}/assistant`),
  );
}

/** Changes the workspace's assistant settings through the API, keeping what the patch omits. */
export async function setAssistantSettings(
  page: Page,
  guide: PublishedGuide,
  patch: Partial<Omit<WorkspaceSettings, "version" | "members" | "instructions">> & {
    instructions?: string;
  },
): Promise<void> {
  const current = await assistantSettings(page, guide);
  await json(
    await page.request.put(`/api/v1/workspaces/${guide.workspaceId}/assistant`, {
      data: {
        version: current.version,
        autonomy: current.autonomy,
        tone: current.tone,
        quietHours: current.quietHours,
        contacts: current.contacts,
        instructions: current.instructions?.text ?? "",
        ...patch,
      },
    }),
  );
}

/** Every topic at one level for the workspace (feature 005's two modes, feature 007's three). */
export async function setAutonomy(page: Page, guide: PublishedGuide, autonomy: Level) {
  await setAssistantSettings(page, guide, { autonomy: allTopics(autonomy) });
}

/** The guide's property link, from the Share overview. */
export async function propertyLink(page: Page, guide: PublishedGuide): Promise<string> {
  const share = await json<{ propertyLink: { url: string } | null }>(
    await page.request.get(`${guide.base}/share`),
  );
  expect(share.propertyLink?.url).toBeTruthy();
  return share.propertyLink!.url;
}

/** Opens the chat from a guide page (the Ask button loads the chat on demand). */
export async function openChat(guest: Page): Promise<void> {
  await guest.getByRole("button", { name: /^(Preguntar|Ask)$/ }).click();
  await expect(guest.getByRole("dialog")).toBeVisible();
  await expect(guest.locator(".chat-intro")).not.toBeEmpty();
}

/** Sends a chat message and waits until it shows as the guest's. */
export async function sendChatMessage(guest: Page, text: string): Promise<void> {
  const dialog = guest.getByRole("dialog");
  await dialog.getByLabel(/^(Tu mensaje|Your message)$/).fill(text);
  await dialog.getByRole("button", { name: /^(Enviar|Send)$/ }).click();
  await expect(dialog.locator(".chat-msg-guest").filter({ hasText: text }).last()).toBeVisible();
}
