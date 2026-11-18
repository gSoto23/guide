import {
  defaultGuideLanguages,
  normalizeAddressKey,
  REQUIRED_FACTS,
  TIME_OF_DAY,
  type CoreFacts,
  type GuideLanguage,
} from "./core-facts.js";
import { COUNTRY_ZONES } from "./time-zone-data.js";
import { isKnownTimeZone, suggestTimeZone, timeZoneMatchesCountry } from "./time-zones.js";

/**
 * CSV import rules (feature 002 US5, FR-037 to FR-042, research R10): the template, header
 * aliases, row validation, duplicate warnings, and the error file. Parsing the bytes happens in
 * the sandbox's file processor; this module only sees cells.
 *
 * Calendar links are restricted: a row's link is returned apart from its values, so it is never
 * stored with them, and the error file leaves its column empty.
 */
export const CSV_COLUMNS = [
  "name",
  "addressLine1",
  "addressUnit",
  "city",
  "region",
  "postalCode",
  "country",
  "timeZone",
  "checkInTime",
  "checkoutTime",
  "maxGuests",
  "guideLanguages",
  "calendarUrl",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
export type CsvValueColumn = Exclude<CsvColumn, "calendarUrl">;
export type CsvLanguage = "es" | "en";

/** Up to 500 data rows and 2 MB per file (FR-038). */
export const CSV_MAX_DATA_ROWS = 500;
export const CSV_MAX_BYTES = 2 * 1024 * 1024;

/** Cells of one row by column, as typed. */
export type CsvCells = Partial<Record<CsvColumn, string>>;

/** An error or warning about a row: the column, the code, and for duplicates the first row. */
export interface CsvIssue {
  column?: CsvColumn;
  code: string;
  row?: number;
}

export const CSV_HEADERS: Record<CsvLanguage, Record<CsvColumn, string>> = {
  es: {
    name: "Nombre",
    addressLine1: "Calle y número",
    addressUnit: "Unidad",
    city: "Ciudad",
    region: "Provincia o región",
    postalCode: "Código postal",
    country: "País",
    timeZone: "Zona horaria",
    checkInTime: "Hora de entrada",
    checkoutTime: "Hora de salida",
    maxGuests: "Máximo de huéspedes",
    guideLanguages: "Idiomas de la guía",
    calendarUrl: "Enlace del calendario (iCal)",
  },
  en: {
    name: "Name",
    addressLine1: "Street and number",
    addressUnit: "Unit",
    city: "City",
    region: "State or region",
    postalCode: "Postal code",
    country: "Country",
    timeZone: "Time zone",
    checkInTime: "Check-in time",
    checkoutTime: "Checkout time",
    maxGuests: "Maximum guests",
    guideLanguages: "Guide languages",
    calendarUrl: "Calendar link (iCal)",
  },
};

/** More header names a spreadsheet may use, besides the template's own (FR-037). */
const MORE_ALIASES: Record<CsvColumn, Record<CsvLanguage, readonly string[]>> = {
  name: { es: ["nombre de la propiedad", "propiedad"], en: ["property name", "property"] },
  addressLine1: {
    es: ["calle", "direccion", "direccion linea 1"],
    en: ["street", "street line", "address", "address line 1"],
  },
  addressUnit: {
    es: ["apartamento", "apto", "numero de unidad"],
    en: ["apartment", "apt", "suite", "address line 2"],
  },
  city: { es: ["localidad", "distrito"], en: ["town"] },
  region: {
    es: ["provincia", "region", "estado", "departamento"],
    en: ["state", "region", "province", "county"],
  },
  postalCode: { es: ["cp"], en: ["zip", "zip code", "postcode"] },
  country: { es: [], en: [] },
  timeZone: { es: [], en: ["timezone"] },
  checkInTime: {
    es: ["entrada", "hora de llegada", "check in"],
    en: ["check in", "checkin", "checkin time", "arrival time"],
  },
  checkoutTime: {
    es: ["salida", "check out"],
    en: ["checkout", "check out", "check out time", "departure time"],
  },
  maxGuests: {
    es: ["huespedes", "capacidad", "personas"],
    en: ["max guests", "guests", "capacity"],
  },
  guideLanguages: { es: ["idiomas", "idioma"], en: ["languages", "language"] },
  calendarUrl: {
    es: ["enlace del calendario", "calendario", "enlace ical", "ical"],
    en: ["calendar link", "calendar", "ical link", "ical url", "ical"],
  },
};

/** Lowercase, without accents, punctuation runs, or extra spaces. */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** Folded header name → its column and the languages it belongs to. */
let headerIndex: Map<string, { column: CsvColumn; languages: Set<CsvLanguage> }> | null = null;

function headers() {
  if (headerIndex) return headerIndex;
  const index = new Map<string, { column: CsvColumn; languages: Set<CsvLanguage> }>();
  const add = (name: string, column: CsvColumn, language: CsvLanguage) => {
    const key = fold(name);
    const entry = index.get(key) ?? { column, languages: new Set<CsvLanguage>() };
    entry.languages.add(language);
    index.set(key, entry);
  };
  for (const column of CSV_COLUMNS) {
    for (const language of ["es", "en"] as const) {
      add(CSV_HEADERS[language][column], column, language);
      for (const alias of MORE_ALIASES[column][language]) add(alias, column, language);
    }
    // The canonical key, as an export from another tool might use it.
    add(column, column, "en");
  }
  headerIndex = index;
  return index;
}

export type CsvHeaderResult =
  | { ok: true; columns: (CsvColumn | null)[]; language: CsvLanguage }
  | { ok: false; error: "missing_name_column" | "duplicate_column" };

/**
 * Maps a header row to columns, matching Spanish and English names without case or accents
 * (FR-037). Unknown columns are ignored. The file's language is the one most headers are in,
 * Spanish on a tie; it decides the default guide languages of rows that leave them blank.
 */
export function readCsvHeader(header: readonly string[]): CsvHeaderResult {
  const index = headers();
  const columns: (CsvColumn | null)[] = [];
  const seen = new Set<CsvColumn>();
  let spanish = 0;
  let english = 0;
  for (const cell of header) {
    const entry = index.get(fold(cell));
    if (!entry) {
      columns.push(null);
      continue;
    }
    if (seen.has(entry.column)) return { ok: false, error: "duplicate_column" };
    seen.add(entry.column);
    columns.push(entry.column);
    if (entry.languages.has("es")) spanish += 1;
    if (entry.languages.has("en")) english += 1;
  }
  if (!seen.has("name")) return { ok: false, error: "missing_name_column" };
  return { ok: true, columns, language: english > spanish ? "en" : "es" };
}

/** A row's cells by column, trimmed; columns the header did not map are dropped. */
export function csvCells(row: readonly string[], columns: readonly (CsvColumn | null)[]): CsvCells {
  const cells: CsvCells = {};
  columns.forEach((column, position) => {
    if (column) cells[column] = (row[position] ?? "").trim();
  });
  return cells;
}

export function isBlankCsvRow(cells: CsvCells): boolean {
  return Object.values(cells).every((value) => !value || value.trim() === "");
}

// --- values ---

const MAX_LENGTHS: Partial<Record<CsvColumn, number>> = {
  name: 120,
  addressLine1: 200,
  addressUnit: 100,
  city: 120,
  region: 120,
  postalCode: 20,
};

/** Country names in Spanish and English → ISO code, built on first use. */
let countryIndex: Map<string, string> | null = null;

function countries(): Map<string, string> {
  if (countryIndex) return countryIndex;
  const index = new Map<string, string>();
  const names = ["es", "en"].map((locale) => new Intl.DisplayNames([locale], { type: "region" }));
  for (const code of Object.keys(COUNTRY_ZONES)) {
    for (const display of names) {
      const name = display.of(code);
      if (name && name !== code) index.set(fold(name), code);
    }
  }
  for (const [alias, code] of [
    ["usa", "US"],
    ["eeuu", "US"],
    ["ee uu", "US"],
    ["uk", "GB"],
  ] as const) {
    index.set(alias, code);
  }
  countryIndex = index;
  return index;
}

/** An ISO 3166-1 alpha-2 code, from a code in any case or a country name. */
export function parseCountry(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) {
    const code = trimmed.toUpperCase();
    return COUNTRY_ZONES[code] ? code : null;
  }
  return countries().get(fold(trimmed)) ?? null;
}

const ZONE_SHAPE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){1,2}$|^UTC$/i;

/** The canonical IANA name of a zone written in any case, or null for an unknown zone. */
export function parseTimeZone(value: string): string | null {
  const trimmed = value.trim();
  if (!ZONE_SHAPE.test(trimmed)) return null;
  try {
    const zone = new Intl.DateTimeFormat("en", { timeZone: trimmed }).resolvedOptions().timeZone;
    return isKnownTimeZone(zone) && ZONE_SHAPE.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

const TIME_WRITTEN = /^(\d{1,2})(?:\s*[:.h]\s*(\d{2})?)?(?::(\d{2}))?\s*(?:(a|p)\.?\s*m\.?)?$/i;

/**
 * A time as `HH:MM` from the ways spreadsheets and people write it: `15:00`, `9:30`, `11:00:00`,
 * `3 pm`, `3:30 p.m.`, `15h`, or `15.30`. Null when it is not a time of day.
 */
export function parseTimeOfDay(value: string): string | null {
  const match = TIME_WRITTEN.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === "p" ? 12 : 0);
  }
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return TIME_OF_DAY.test(time) ? time : null;
}

const LANGUAGE_WORDS: Record<string, GuideLanguage> = {
  es: "es",
  esp: "es",
  spa: "es",
  espanol: "es",
  castellano: "es",
  spanish: "es",
  en: "en",
  eng: "en",
  ingles: "en",
  english: "en",
};
const LANGUAGE_JOINERS = new Set(["y", "e", "and"]);

/** Guide languages from codes or names, in the order written; null when one is unknown. */
export function parseGuideLanguages(value: string): GuideLanguage[] | null {
  const languages: GuideLanguage[] = [];
  for (const word of fold(value).split(" ")) {
    if (!word || LANGUAGE_JOINERS.has(word)) continue;
    const language = LANGUAGE_WORDS[word];
    if (!language) return null;
    if (!languages.includes(language)) languages.push(language);
  }
  return languages.length > 0 ? languages : null;
}

/** True for an `https:` link of at most 2,048 characters; nothing is fetched (FR-042). */
export function isCalendarLinkFormat(value: string): boolean {
  if (value.length > 2048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// --- rows ---

export interface CsvRow {
  rowNumber: number;
  /**
   * The values to keep, never the calendar link: normalized when valid (country code, `HH:MM`,
   * zone, languages), as typed otherwise, so the error file shows what the host wrote.
   */
  values: Partial<Record<CsvValueColumn, string>>;
  /** The link, only when its format is valid; stored encrypted apart from the values. */
  calendarUrl: string | null;
  /** Facts from the valid values; a blank zone is suggested from the country and city. */
  facts: CoreFacts;
  errors: CsvIssue[];
  warnings: CsvIssue[];
  /** No error outside the calendar link column: the row can be created (FR-040, FR-042). */
  creatable: boolean;
}

/**
 * Validates one row (FR-039): every column is checked and every error kept, never just the
 * first. Only a missing name blocks the row by itself; other missing facts are warnings, and the
 * property is created needing details. An invalid calendar link is an error for that column
 * only (FR-042).
 */
export function validateCsvRow(rowNumber: number, cells: CsvCells, language: CsvLanguage): CsvRow {
  const errors: CsvIssue[] = [];
  const warnings: CsvIssue[] = [];
  const values: Partial<Record<CsvValueColumn, string>> = {};
  const facts: CoreFacts = {
    name: null,
    addressLine1: null,
    addressUnit: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    timeZone: null,
    checkInTime: null,
    checkoutTime: null,
    maxGuests: null,
    guideLanguages: null,
  };
  const failed = new Set<CsvColumn>();
  const fail = (column: CsvColumn, code: string) => {
    errors.push({ column, code });
    failed.add(column);
  };
  const cell = (column: CsvColumn) => (cells[column] ?? "").trim();

  for (const column of [
    "name",
    "addressLine1",
    "addressUnit",
    "city",
    "region",
    "postalCode",
  ] as const) {
    const value = cell(column);
    if (!value) {
      if (column === "name") fail(column, "required");
      continue;
    }
    values[column] = value;
    if (value.length > MAX_LENGTHS[column]!) fail(column, "too_long");
    else facts[column] = value;
  }

  const country = cell("country");
  if (country) {
    const code = parseCountry(country);
    values.country = code ?? country;
    if (code) facts.country = code;
    else fail("country", "invalid_country");
  }

  const zone = cell("timeZone");
  if (zone) {
    const parsed = parseTimeZone(zone);
    values.timeZone = parsed ?? zone;
    if (!parsed) fail("timeZone", "invalid_time_zone");
    else {
      facts.timeZone = parsed;
      if (facts.country && !timeZoneMatchesCountry(parsed, facts.country)) {
        warnings.push({ column: "timeZone", code: "time_zone_mismatch" });
      }
    }
  } else if (facts.country) {
    facts.timeZone = suggestTimeZone(facts.country, facts.city).suggested;
    if (facts.timeZone) values.timeZone = facts.timeZone;
  }

  for (const column of ["checkInTime", "checkoutTime"] as const) {
    const value = cell(column);
    if (!value) continue;
    const time = parseTimeOfDay(value);
    values[column] = time ?? value;
    if (time) facts[column] = time;
    else fail(column, "invalid_time");
  }

  const guests = cell("maxGuests");
  if (guests) {
    const count = /^\d{1,3}$/.test(guests) ? Number(guests) : NaN;
    values.maxGuests = guests;
    if (count >= 1 && count <= 50) facts.maxGuests = count;
    else fail("maxGuests", "invalid_guests");
  }

  const written = cell("guideLanguages");
  const languages = written ? parseGuideLanguages(written) : defaultGuideLanguages(language);
  if (languages) {
    facts.guideLanguages = languages;
    values.guideLanguages = languages.join(", ");
  } else {
    values.guideLanguages = written;
    fail("guideLanguages", "invalid_language");
  }

  const link = cell("calendarUrl");
  let calendarUrl: string | null = null;
  if (link) {
    if (isCalendarLinkFormat(link)) calendarUrl = link;
    else fail("calendarUrl", "invalid_calendar_link");
  }

  for (const fact of REQUIRED_FACTS) {
    if (fact === "name" || failed.has(fact)) continue;
    const value = facts[fact];
    if (value === null || value === undefined) warnings.push({ column: fact, code: "missing" });
  }

  return {
    rowNumber,
    values,
    calendarUrl,
    facts,
    errors,
    warnings,
    creatable: errors.every((error) => error.column === "calendarUrl"),
  };
}

/** What makes two rows the same property: the address when known, else the name. */
function sameness(facts: CoreFacts): { column: CsvColumn; key: string } | null {
  const address = normalizeAddressKey(facts);
  if (address) return { column: "addressLine1", key: `address:${address}` };
  const name = fold(facts.name ?? "");
  return name ? { column: "name", key: `name:${name}` } : null;
}

/**
 * Flags rows that repeat an earlier row of the file, and rows matching a property the workspace
 * already has by address or by name (FR-040). Warnings never block a row.
 */
export function flagCsvDuplicates<Row extends Pick<CsvRow, "rowNumber" | "facts" | "warnings">>(
  rows: readonly Row[],
  existing: readonly { name: string; addressKey: string | null }[],
): Row[] {
  const existingAddresses = new Set(existing.map((item) => item.addressKey).filter(Boolean));
  const existingNames = new Set(existing.map((item) => fold(item.name)));
  const firstRow = new Map<string, number>();
  return rows.map((row) => {
    const warnings = [...row.warnings];
    const address = normalizeAddressKey(row.facts);
    const name = fold(row.facts.name ?? "");
    if (address && existingAddresses.has(address)) {
      warnings.push({ column: "addressLine1", code: "existing_property" });
    } else if (name && existingNames.has(name)) {
      warnings.push({ column: "name", code: "existing_property" });
    }
    const same = sameness(row.facts);
    if (same) {
      const first = firstRow.get(same.key);
      if (first === undefined) firstRow.set(same.key, row.rowNumber);
      else warnings.push({ column: same.column, code: "duplicate_row", row: first });
    }
    return { ...row, warnings };
  });
}

// --- downloads ---

/**
 * Prefixes a cell that a spreadsheet would read as a formula with `'` (FR-041, AC-SEC-006):
 * cells starting with `=`, `+`, `-`, `@`, tab, or carriage return.
 */
export function neutralizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Semicolons for Spanish, which spreadsheets in Spanish expect; commas for English. */
export function csvDelimiter(language: CsvLanguage): ";" | "," {
  return language === "es" ? ";" : ",";
}

const TEMPLATE_INSTRUCTIONS: Record<CsvLanguage, readonly string[]> = {
  es: [
    "# Guidesk: plantilla para crear propiedades. Usa una fila por propiedad.",
    "# Las filas que empiezan con # se ignoran, como esta y el ejemplo de abajo.",
    "# Solo el nombre es obligatorio. Si falta otro dato, la propiedad queda con datos pendientes y lo completas después.",
    "# País: código de 2 letras (CR) o nombre. Horas: 15:00. Idiomas: es, en o ambos. Zona horaria: por ejemplo America/Costa_Rica; si la dejas vacía, la sugerimos.",
    "# Enlace del calendario (opcional): el enlace https para exportar el calendario (iCal) de tu canal. Nunca escribas códigos de puertas, de cajas de llaves ni contraseñas.",
    "# Hasta 500 filas y 2 MB. Guarda el archivo como CSV UTF-8.",
  ],
  en: [
    "# Guidesk: template for creating properties. Use one row per property.",
    "# Rows that start with # are ignored, like this one and the example below.",
    "# Only the name is required. If anything else is missing, the property is created needing details, which you fill in later.",
    "# Country: 2-letter code (US) or name. Times: 15:00. Languages: en, es, or both. Time zone: for example America/New_York; leave it blank and we suggest one.",
    "# Calendar link (optional): your channel's https calendar export (iCal) link. Never type door codes, lockbox codes, or passwords.",
    "# Up to 500 rows and 2 MB. Save the file as CSV UTF-8.",
  ],
};

const TEMPLATE_EXAMPLES: Record<CsvLanguage, Record<CsvColumn, string>> = {
  es: {
    name: "# Casa Colibrí (ejemplo)",
    addressLine1: "Calle Ficticia 123",
    addressUnit: "",
    city: "Sámara",
    region: "Guanacaste",
    postalCode: "50205",
    country: "CR",
    timeZone: "America/Costa_Rica",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    maxGuests: "4",
    guideLanguages: "es, en",
    calendarUrl: "",
  },
  en: {
    name: "# Hummingbird House (example)",
    addressLine1: "123 Fictional Street",
    addressUnit: "",
    city: "Sámara",
    region: "Guanacaste",
    postalCode: "50205",
    country: "CR",
    timeZone: "America/Costa_Rica",
    checkInTime: "15:00",
    checkoutTime: "11:00",
    maxGuests: "4",
    guideLanguages: "en, es",
    calendarUrl: "",
  },
};

/**
 * The template's rows (FR-037, research R10): instructions as `#` rows, the header, and one
 * example row that also starts with `#`, so a template uploaded unchanged creates nothing.
 */
export function csvTemplateRows(language: CsvLanguage): string[][] {
  return [
    ...TEMPLATE_INSTRUCTIONS[language].map((line) => [line]),
    CSV_COLUMNS.map((column) => CSV_HEADERS[language][column]),
    CSV_COLUMNS.map((column) => TEMPLATE_EXAMPLES[language][column]),
  ];
}

const REASONS: Record<CsvLanguage, Record<string, string>> = {
  es: {
    required: "falta este dato",
    too_long: "es demasiado largo",
    invalid_country: "país no reconocido",
    invalid_time_zone: "zona horaria no reconocida",
    invalid_time: "usa una hora como 15:00",
    invalid_guests: "usa un número entero del 1 al 50",
    invalid_language: "usa es, en o ambos",
    invalid_calendar_link: "el enlace debe empezar con https://",
    calendar_rejected: "no pudimos leer este calendario, agrégalo desde la propiedad",
    missing: "falta, la propiedad quedará con datos pendientes",
    duplicate_row: "repite la fila {row}",
    existing_property: "ya tienes una propiedad igual",
    time_zone_mismatch: "la zona horaria no es de ese país",
    other: "revisa este dato",
  },
  en: {
    required: "this is required",
    too_long: "too long",
    invalid_country: "country not recognized",
    invalid_time_zone: "time zone not recognized",
    invalid_time: "use a time like 15:00",
    invalid_guests: "use a whole number from 1 to 50",
    invalid_language: "use en, es, or both",
    invalid_calendar_link: "the link must start with https://",
    calendar_rejected: "we couldn't read this calendar. Add it from the property",
    missing: "missing, so the property will need details",
    duplicate_row: "repeats row {row}",
    existing_property: "you already have a property like this",
    time_zone_mismatch: "the time zone isn't in that country",
    other: "check this value",
  },
};

/** "Column: reason" in the host's language, for the error file. */
export function csvIssueText(issue: CsvIssue, language: CsvLanguage): string {
  const reason = (REASONS[language][issue.code] ?? REASONS[language].other!).replace(
    "{row}",
    String(issue.row ?? ""),
  );
  return issue.column ? `${CSV_HEADERS[language][issue.column]}: ${reason}` : reason;
}

const ERROR_FILE_TEXT: Record<CsvLanguage, { row: string; errors: string; notes: string[] }> = {
  es: {
    row: "Fila",
    errors: "Errores",
    notes: [
      "# Guidesk: filas con errores. Corrígelas aquí y sube este archivo de nuevo; las columnas Fila y Errores se ignoran.",
      "# Por seguridad, los enlaces del calendario no se incluyen: vuelve a pegarlos.",
    ],
  },
  en: {
    row: "Row",
    errors: "Errors",
    notes: [
      "# Guidesk: rows with errors. Fix them here and upload this file again; the Row and Errors columns are ignored.",
      "# For your security, calendar links are not included: paste them again.",
    ],
  },
};

/**
 * The error file's rows (FR-039, FR-041, FR-042): every row with an error, its row number, its
 * reasons in the host's language, and its values with the calendar link left empty. Every cell
 * is neutralized.
 */
export function csvErrorFileRows(
  items: readonly {
    rowNumber: number;
    values: Partial<Record<CsvColumn, string>> | null;
    errors: readonly CsvIssue[];
  }[],
  language: CsvLanguage,
): string[][] {
  const text = ERROR_FILE_TEXT[language];
  const rows: string[][] = [
    ...text.notes.map((line) => [line]),
    [text.row, text.errors, ...CSV_COLUMNS.map((column) => CSV_HEADERS[language][column])],
  ];
  const withErrors = [...items]
    .filter((item) => item.errors.length > 0)
    .sort((a, b) => a.rowNumber - b.rowNumber);
  for (const item of withErrors) {
    rows.push([
      String(item.rowNumber),
      item.errors.map((issue) => csvIssueText(issue, language)).join("; "),
      ...CSV_COLUMNS.map((column) =>
        column === "calendarUrl" ? "" : (item.values?.[column] ?? ""),
      ),
    ]);
  }
  return rows.map((row) => row.map(neutralizeCell));
}
