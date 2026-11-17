import { Controller, Get, Headers, Query } from "@nestjs/common";
import {
  timeZoneSuggestQuerySchema,
  timeZonesQuerySchema,
  type TimeZoneList,
  type TimeZoneOption,
  type TimeZoneSuggestion,
} from "@guidesk/contracts";
import { suggestTimeZone, zonesForCountry } from "@guidesk/domain";
import { ZodValidationPipe } from "../common/zod.pipe.js";
import { WorkspaceAction } from "../tenancy/workspace-access.guard.js";

/** Spanish unless the request prefers English. */
function languageOf(acceptLanguage: string | undefined): "es" | "en" {
  return acceptLanguage?.trim().toLowerCase().startsWith("en") ? "en" : "es";
}

function zonePart(zone: string, language: string, style: "longGeneric" | "shortOffset", at: Date) {
  return (
    new Intl.DateTimeFormat(language, { timeZone: zone, timeZoneName: style })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

/** "GMT-6" → "UTC−06:00"; "GMT" → "UTC±00:00". */
function formatOffset(gmt: string): string {
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(gmt);
  if (!match) return "UTC±00:00";
  const sign = match[1] === "-" ? "−" : "+";
  return `UTC${sign}${match[2]!.padStart(2, "0")}:${match[3] ?? "00"}`;
}

/** A zone with its local name, its main city, and its current offset (FR-002). */
export function describeZone(zone: string, language: "es" | "en", at = new Date()): TimeZoneOption {
  const city = zone.split("/").at(-1)?.replaceAll("_", " ") ?? zone;
  return {
    id: zone,
    name: `${zonePart(zone, language, "longGeneric", at)} (${city})`,
    offset: formatOffset(zonePart(zone, "en-US", "shortOffset", at)),
  };
}

/**
 * /api/v1/workspaces/{workspaceId}/time-zones (T043). Served from Guidesk's own reference data;
 * no outside service is called (FR-002, research R11).
 */
@Controller("v1/workspaces/:workspaceId/time-zones")
export class TimeZonesController {
  @Get()
  @WorkspaceAction({ capability: "properties.manage" })
  list(
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Query(new ZodValidationPipe(timeZonesQuerySchema)) query: { country: string },
  ): TimeZoneList {
    const language = languageOf(acceptLanguage);
    return { zones: zonesForCountry(query.country).map((zone) => describeZone(zone, language)) };
  }

  @Get("suggest")
  @WorkspaceAction({ capability: "properties.manage" })
  suggest(
    @Headers("accept-language") acceptLanguage: string | undefined,
    @Query(new ZodValidationPipe(timeZoneSuggestQuerySchema))
    query: { country: string; city?: string },
  ): TimeZoneSuggestion {
    const language = languageOf(acceptLanguage);
    const result = suggestTimeZone(query.country, query.city);
    return {
      suggested: result.suggested,
      choices: result.choices.map((zone) => describeZone(zone, language)),
    };
  }
}
