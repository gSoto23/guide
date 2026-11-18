import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  CSV_HEADERS,
  csvErrorFileRows,
  csvIssueText,
  csvTemplateRows,
  flagCsvDuplicates,
  isBlankCsvRow,
  neutralizeCell,
  parseTimeOfDay,
  readCsvHeader,
  validateCsvRow,
  type CsvCells,
} from "../../src/properties/csv.js";

/** A complete, valid row in canonical columns. All data is fictional. */
const complete: CsvCells = {
  name: "Casa Colibrí",
  addressLine1: "Calle Ficticia 123",
  city: "Sámara",
  region: "Guanacaste",
  postalCode: "50205",
  country: "CR",
  timeZone: "America/Costa_Rica",
  checkInTime: "15:00",
  checkoutTime: "11:00",
  maxGuests: "4",
  guideLanguages: "es, en",
};

const codes = (issues: readonly { column?: string; code: string }[]) =>
  issues.map((issue) => `${issue.column ?? "-"}:${issue.code}`);

describe("header aliases (FR-037)", () => {
  it("maps Spanish headers without case or accents, and detects Spanish", () => {
    const result = readCsvHeader([
      "NOMBRE",
      "Calle y numero",
      "unidad",
      "Ciudad",
      "Provincia",
      "Código Postal",
      "pais",
      "Zona Horaria",
      "Hora de Entrada",
      "Hora de salida",
      "Maximo de huespedes",
      "Idiomas de la guía",
      "Enlace del calendario (iCal)",
    ]);
    expect(result).toEqual({ ok: true, language: "es", columns: [...CSV_COLUMNS] });
  });

  it("maps English headers, and detects English", () => {
    const result = readCsvHeader([
      "Name",
      "Street and number",
      "Unit",
      "City",
      "State or region",
      "Postal code",
      "Country",
      "Time zone",
      "Check-in time",
      "Check-out time",
      "Max guests",
      "Guide languages",
      "Calendar link",
    ]);
    expect(result).toEqual({ ok: true, language: "en", columns: [...CSV_COLUMNS] });
  });

  it("ignores unknown columns, such as the error file's row and reason columns", () => {
    const result = readCsvHeader(["Fila", "Errores", "Nombre", "Notas"]);
    expect(result).toEqual({ ok: true, language: "es", columns: [null, null, "name", null] });
  });

  it("needs a name column", () => {
    expect(readCsvHeader(["Ciudad", "País"])).toEqual({ ok: false, error: "missing_name_column" });
  });

  it("refuses a column given twice", () => {
    expect(readCsvHeader(["Nombre", "Name"])).toEqual({ ok: false, error: "duplicate_column" });
  });

  it("reads both templates back", () => {
    for (const language of ["es", "en"] as const) {
      const rows = csvTemplateRows(language);
      const header = rows.find((row) => !row[0]!.startsWith("#"))!;
      expect(header).toEqual(CSV_COLUMNS.map((column) => CSV_HEADERS[language][column]));
      expect(readCsvHeader(header)).toEqual({ ok: true, language, columns: [...CSV_COLUMNS] });
    }
  });
});

describe("the template (FR-037)", () => {
  it("has instructions and one example row, all ignored when read back", () => {
    const rows = csvTemplateRows("es");
    const comments = rows.filter((row) => row[0]!.startsWith("#"));
    // Instructions, then the example row, which starts with "#" so it is never created.
    expect(comments.length).toBeGreaterThanOrEqual(3);
    const example = rows.at(-1)!;
    expect(example[0]).toMatch(/^# /);
    expect(example).toHaveLength(CSV_COLUMNS.length);
    expect(rows.flat().join(" ")).toMatch(/código|códigos/);
    expect(csvTemplateRows("en").flat().join(" ")).toMatch(/door code/i);
  });
});

describe("row validation (FR-039)", () => {
  it("accepts a complete row and normalizes it", () => {
    const row = validateCsvRow(2, complete, "es");
    expect(row.errors).toEqual([]);
    expect(row.warnings).toEqual([]);
    expect(row.creatable).toBe(true);
    expect(row.facts).toEqual({
      name: "Casa Colibrí",
      addressLine1: "Calle Ficticia 123",
      addressUnit: null,
      city: "Sámara",
      region: "Guanacaste",
      postalCode: "50205",
      country: "CR",
      timeZone: "America/Costa_Rica",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
      guideLanguages: ["es", "en"],
    });
  });

  it("collects every error of a row, by column and code", () => {
    const row = validateCsvRow(
      7,
      {
        ...complete,
        country: "Narnia",
        checkInTime: "tarde",
        maxGuests: "cuatro",
        guideLanguages: "fr",
      },
      "es",
    );
    expect(codes(row.errors)).toEqual([
      "country:invalid_country",
      "checkInTime:invalid_time",
      "maxGuests:invalid_guests",
      "guideLanguages:invalid_language",
    ]);
    expect(row.creatable).toBe(false);
    // The values typed are kept for the error file.
    expect(row.values).toMatchObject({ country: "Narnia", checkInTime: "tarde" });
  });

  it("requires the name, and checks lengths", () => {
    const row = validateCsvRow(3, { ...complete, name: "", city: "x".repeat(121) }, "es");
    expect(codes(row.errors)).toEqual(["name:required", "city:too_long"]);
  });

  it("creates a row with missing facts, which will need details, and says so", () => {
    const row = validateCsvRow(4, { name: "Cabina Norte", country: "CR" }, "es");
    expect(row.errors).toEqual([]);
    expect(row.creatable).toBe(true);
    expect(codes(row.warnings)).toEqual([
      "addressLine1:missing",
      "city:missing",
      "checkInTime:missing",
      "checkoutTime:missing",
      "maxGuests:missing",
    ]);
    // The time zone comes from the country, and the languages from the file's language.
    expect(row.facts.timeZone).toBe("America/Costa_Rica");
    expect(row.facts.guideLanguages).toEqual(["es", "en"]);
    expect(validateCsvRow(4, { name: "North Cabin" }, "en").facts.guideLanguages).toEqual([
      "en",
      "es",
    ]);
  });

  it("reads countries by code or by name in Spanish or English", () => {
    for (const [value, code] of [
      ["cr", "CR"],
      ["Costa Rica", "CR"],
      ["España", "ES"],
      ["mexico", "MX"],
      ["United States", "US"],
    ] as const) {
      expect(
        validateCsvRow(2, { ...complete, country: value, timeZone: "" }, "es").facts.country,
      ).toBe(code);
    }
  });

  it("reads times the way spreadsheets write them", () => {
    expect(parseTimeOfDay("15:00")).toBe("15:00");
    expect(parseTimeOfDay("9:30")).toBe("09:30");
    expect(parseTimeOfDay("11:00:00")).toBe("11:00");
    expect(parseTimeOfDay("3 pm")).toBe("15:00");
    expect(parseTimeOfDay("3:30 p.m.")).toBe("15:30");
    expect(parseTimeOfDay("12 am")).toBe("00:00");
    expect(parseTimeOfDay("15h")).toBe("15:00");
    expect(parseTimeOfDay("15.30")).toBe("15:30");
    expect(parseTimeOfDay("25:00")).toBeNull();
    expect(parseTimeOfDay("13 pm")).toBeNull();
    expect(parseTimeOfDay("mediodía")).toBeNull();
  });

  it("validates time zones (FR-002)", () => {
    expect(
      validateCsvRow(2, { ...complete, timeZone: "america/costa_rica" }, "es").facts.timeZone,
    ).toBe("America/Costa_Rica");
    const unknown = validateCsvRow(2, { ...complete, timeZone: "Mars/Olympus" }, "es");
    expect(codes(unknown.errors)).toEqual(["timeZone:invalid_time_zone"]);
    // A zone of another country is a warning, as in the form.
    const other = validateCsvRow(2, { ...complete, timeZone: "Europe/Madrid" }, "es");
    expect(other.errors).toEqual([]);
    expect(codes(other.warnings)).toEqual(["timeZone:time_zone_mismatch"]);
    // No zone and a country with several: the host chooses later.
    const several = validateCsvRow(
      2,
      { ...complete, country: "US", city: "Pueblo Ficticio", timeZone: "" },
      "en",
    );
    expect(several.facts.timeZone).toBeNull();
    expect(codes(several.warnings)).toEqual(["timeZone:missing"]);
  });

  it("validates maximum guests from 1 to 50", () => {
    for (const value of ["0", "51", "4.5", "-2"]) {
      expect(codes(validateCsvRow(2, { ...complete, maxGuests: value }, "es").errors)).toEqual([
        "maxGuests:invalid_guests",
      ]);
    }
    expect(validateCsvRow(2, { ...complete, maxGuests: "12" }, "es").facts.maxGuests).toBe(12);
  });

  it("reads guide languages by code or by name", () => {
    const read = (value: string) =>
      validateCsvRow(2, { ...complete, guideLanguages: value }, "es").facts.guideLanguages;
    expect(read("en")).toEqual(["en"]);
    expect(read("Español; Inglés")).toEqual(["es", "en"]);
    expect(read("english / spanish")).toEqual(["en", "es"]);
    expect(read("es, es")).toEqual(["es"]);
  });

  it("checks the calendar link's syntax only, and keeps it out of the values", () => {
    const link = "https://www.airbnb.com/calendar/ical/123.ics?s=fictional";
    const row = validateCsvRow(2, { ...complete, calendarUrl: link }, "es");
    expect(row.errors).toEqual([]);
    expect(row.calendarUrl).toBe(link);
    expect(Object.values(row.values)).not.toContain(link);

    for (const bad of ["http://example.com/cal.ics", "calendario de airbnb", "ftp://x.test/a"]) {
      const invalid = validateCsvRow(2, { ...complete, calendarUrl: bad }, "es");
      expect(codes(invalid.errors)).toEqual(["calendarUrl:invalid_calendar_link"]);
      // The row can still be created, without the link (FR-042).
      expect(invalid.creatable).toBe(true);
      expect(invalid.calendarUrl).toBeNull();
      expect(Object.values(invalid.values)).not.toContain(bad);
    }
  });

  it("treats a row of blank cells as blank", () => {
    expect(isBlankCsvRow({ name: " ", city: "" })).toBe(true);
    expect(isBlankCsvRow({ city: "Sámara" })).toBe(false);
  });
});

describe("duplicate warnings (FR-040)", () => {
  it("flags rows that repeat an earlier row, and rows matching an existing property", () => {
    const rows = [
      validateCsvRow(2, complete, "es"),
      validateCsvRow(3, { ...complete, name: "Casa Colibrí 2" }, "es"),
      validateCsvRow(
        4,
        { ...complete, name: "Torre Mar 4B", addressLine1: "Avenida Ficticia 9" },
        "es",
      ),
      validateCsvRow(5, { name: "Cabina sin dirección" }, "es"),
      validateCsvRow(6, { name: "cabina SIN direccion" }, "es"),
      validateCsvRow(
        7,
        { ...complete, name: "Villa Nueva", addressLine1: "Camino Ficticio 1" },
        "es",
      ),
    ];
    const flagged = flagCsvDuplicates(rows, [
      { name: "Torre Mar 4B", addressKey: null },
      { name: "Otra", addressKey: "camino ficticio 1||samara|cr" },
    ]);
    const warningsOf = (row: number) =>
      flagged.find((item) => item.rowNumber === row)!.warnings.filter((w) => w.code !== "missing");
    expect(warningsOf(2)).toEqual([]);
    expect(warningsOf(3)).toEqual([{ column: "addressLine1", code: "duplicate_row", row: 2 }]);
    expect(warningsOf(4)).toEqual([{ column: "name", code: "existing_property" }]);
    expect(warningsOf(5)).toEqual([]);
    expect(warningsOf(6)).toEqual([{ column: "name", code: "duplicate_row", row: 5 }]);
    expect(warningsOf(7)).toEqual([{ column: "addressLine1", code: "existing_property" }]);
    // Warnings never block a row.
    expect(flagged.every((row) => row.creatable)).toBe(true);
  });
});

describe("formula cells in downloads (FR-041, AC-SEC-006)", () => {
  it("prefixes cells that start with a formula character", () => {
    expect(neutralizeCell('=HYPERLINK("https://evil.example")')).toBe(
      `'=HYPERLINK("https://evil.example")`,
    );
    for (const lead of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(neutralizeCell(`${lead}1`)).toBe(`'${lead}1`);
    }
    expect(neutralizeCell("Casa Colibrí")).toBe("Casa Colibrí");
    expect(neutralizeCell("")).toBe("");
  });

  it("writes an error file with localized reasons, neutralized cells, and no calendar links", () => {
    const formula = validateCsvRow(
      9,
      { ...complete, name: '=HYPERLINK("https://evil.example")', country: "Narnia" },
      "es",
    );
    const linkRejected = {
      rowNumber: 12,
      values: validateCsvRow(12, complete, "es").values,
      errors: [{ column: "calendarUrl" as const, code: "calendar_rejected" }],
    };
    const rows = csvErrorFileRows([formula, linkRejected], "es");
    const header = rows.find((row) => !row[0]!.startsWith("#"))!;
    expect(header.slice(0, 2)).toEqual(["Fila", "Errores"]);
    expect(header.slice(2)).toEqual(CSV_COLUMNS.map((column) => CSV_HEADERS.es[column]));
    const data = rows.slice(rows.indexOf(header) + 1);
    expect(data).toHaveLength(2);
    expect(data[0]![0]).toBe("9");
    expect(data[0]![1]).toBe("País: país no reconocido");
    expect(data[0]![2]).toBe(`'=HYPERLINK("https://evil.example")`);
    expect(data[1]![1]).toMatch(/^Enlace del calendario \(iCal\): /);
    const calendarIndex = header.indexOf(CSV_HEADERS.es.calendarUrl);
    expect(data.map((row) => row[calendarIndex])).toEqual(["", ""]);
    // Every cell is neutralized, the instructions included.
    for (const cell of rows.flat()) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
    expect(rows.slice(0, rows.indexOf(header)).flat().join(" ")).toMatch(/calendario/i);
  });

  it("explains each reason in the host's language", () => {
    expect(csvIssueText({ column: "timeZone", code: "invalid_time_zone" }, "es")).toBe(
      "Zona horaria: zona horaria no reconocida",
    );
    expect(csvIssueText({ column: "timeZone", code: "invalid_time_zone" }, "en")).toBe(
      "Time zone: time zone not recognized",
    );
  });
});
