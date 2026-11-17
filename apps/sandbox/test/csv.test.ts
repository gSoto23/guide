import { describe, expect, it } from "vitest";
import { CSV_MAX_BYTES } from "@guidesk/domain";
import { createFileProcessor, type ObjectSource } from "../src/file-processor/handler.js";
import { parseCsvFile } from "../src/file-processor/csv.js";

/**
 * The file processor's CSV mode (feature 002 US5, FR-038, T104): encodings, separators, `#` rows,
 * limits, and binary files. All data is fictional.
 */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8 = (text: string) => Buffer.from(text, "utf8");

const SPANISH = [
  "# Guidesk: plantilla; una fila por propiedad.",
  '"# Las filas que empiezan con #; se ignoran"',
  "Nombre;Calle y número;Ciudad;País;Máximo de huéspedes",
  "# Casa Colibrí (ejemplo);Calle Ficticia 123;Sámara;CR;4",
  'Cabaña Ñandú;"Calle 5, San José";Atenas;Costa Rica;6',
  "",
  "Villa Él;Avenida Ficticia 9;Nosara;CR;2",
].join("\r\n");

describe("encodings (FR-038)", () => {
  it("reads UTF-8 with and without a byte-order mark the same way", () => {
    const plain = parseCsvFile(utf8(SPANISH));
    const marked = parseCsvFile(Buffer.concat([BOM, utf8(SPANISH)]));
    expect(marked).toEqual(plain);
    expect(plain).toEqual({
      rows: [
        ["Nombre", "Calle y número", "Ciudad", "País", "Máximo de huéspedes"],
        ["Cabaña Ñandú", "Calle 5, San José", "Atenas", "Costa Rica", "6"],
        ["Villa Él", "Avenida Ficticia 9", "Nosara", "CR", "2"],
      ],
      // Row numbers as a spreadsheet shows them: `#` rows and blank rows still count.
      rowNumbers: [3, 5, 7],
    });
  });

  it("reads a file a spreadsheet saved in Windows-1252", () => {
    const latin = Buffer.from("Nombre,Ciudad\nCabaña Ñandú,Sámara\n", "latin1");
    expect(parseCsvFile(latin)).toEqual({
      rows: [
        ["Nombre", "Ciudad"],
        ["Cabaña Ñandú", "Sámara"],
      ],
      rowNumbers: [1, 2],
    });
  });
});

describe("separators (FR-038)", () => {
  it("uses commas when the header line has more commas than semicolons", () => {
    const file = utf8('Name,Street and number,City\nHummingbird House,"Calle 5; Lote 2",Sámara\n');
    expect(parseCsvFile(file)).toEqual({
      rows: [
        ["Name", "Street and number", "City"],
        ["Hummingbird House", "Calle 5; Lote 2", "Sámara"],
      ],
      rowNumbers: [1, 2],
    });
  });

  it("finds the header line after the instruction rows", () => {
    const file = utf8("# Notes, with, commas\nNombre;Ciudad\nCasa;Sámara\n");
    expect(parseCsvFile(file)).toMatchObject({
      rows: [
        ["Nombre", "Ciudad"],
        ["Casa", "Sámara"],
      ],
    });
  });

  it("keeps short rows short and quoted line breaks inside a cell", () => {
    const file = utf8('Nombre;Ciudad;País\nCasa;"Sámara\nGuanacaste"\n');
    expect(parseCsvFile(file)).toEqual({
      rows: [
        ["Nombre", "Ciudad", "País"],
        ["Casa", "Sámara\nGuanacaste"],
      ],
      rowNumbers: [1, 2],
    });
  });
});

describe("limits (FR-038)", () => {
  const header = "Nombre;Ciudad";
  const rows = (count: number) =>
    [header, ...Array.from({ length: count }, (_, i) => `Casa ${i + 1};Sámara`)].join("\n");

  it("accepts 500 data rows and refuses 501", () => {
    const accepted = parseCsvFile(utf8(rows(500)));
    expect("rows" in accepted && accepted.rows).toHaveLength(501);
    expect(parseCsvFile(utf8(rows(501)))).toEqual({ error: "too_many_rows" });
  });

  it("does not count `#` rows and blank rows toward the limit", () => {
    const notes = Array.from({ length: 20 }, () => "# nota").join("\n");
    const accepted = parseCsvFile(utf8(`${notes}\n${rows(500)}\n\n\n`));
    expect("rows" in accepted && accepted.rows).toHaveLength(501);
  });

  it("refuses a file over 2 MB", () => {
    const big = Buffer.alloc(CSV_MAX_BYTES + 1, "a");
    expect(parseCsvFile(big)).toEqual({ error: "too_large" });
  });

  it("refuses a file with far too many lines before parsing it", () => {
    expect(parseCsvFile(utf8("a\n".repeat(100_000)))).toEqual({ error: "too_many_rows" });
  });
});

describe("files that are not CSV (AC-SEC-005)", () => {
  it("refuses images, spreadsheets, and other binary files", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    const xlsx = Buffer.concat([Buffer.from("PK\u0003\u0004", "latin1"), Buffer.alloc(40, 1)]);
    const utf16 = Buffer.from("\ufeffNombre,Ciudad\n", "utf16le");
    for (const file of [png, xlsx, utf16, Buffer.from([0x4e, 0x00, 0x6f, 0x6d])]) {
      expect(parseCsvFile(file)).toEqual({ error: "unsupported_type" });
    }
  });

  it("answers unreadable for an empty file or a broken quote", () => {
    expect(parseCsvFile(Buffer.alloc(0))).toEqual({ error: "unreadable" });
    expect(parseCsvFile(utf8('Nombre;Ciudad\n"Casa;Sámara\n'))).toEqual({ error: "unreadable" });
  });
});

describe("the CSV mode of the file processor", () => {
  const KEY = "uploads/0b5c7a52-3f1e-4c8e-9a51-6d2f0e7b9c10/7e4d2a91-5b6c-4f3a-8e2d-1c9b0a7f6e54";

  function storageWith(bytes: Buffer) {
    const deleted: string[] = [];
    const storage: ObjectSource = {
      get: async (key) => (key === KEY ? bytes : null),
      delete: async (key) => void deleted.push(key),
    };
    return { storage, deleted };
  }

  it("returns the rows and deletes the file", async () => {
    const { storage, deleted } = storageWith(utf8(SPANISH));
    const processFile = createFileProcessor({
      storage,
      recognizer: { recognize: async () => "not used" },
    });
    const response = await processFile({ objectKey: KEY, purpose: "csv" });
    expect(response).toMatchObject({ rowNumbers: [3, 5, 7] });
    expect(deleted).toEqual([KEY]);
  });

  it("deletes a refused file too", async () => {
    const { storage, deleted } = storageWith(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
    const processFile = createFileProcessor({
      storage,
      recognizer: { recognize: async () => "not used" },
    });
    expect(await processFile({ objectKey: KEY, purpose: "csv" })).toEqual({
      error: "unsupported_type",
    });
    expect(deleted).toEqual([KEY]);
  });
});
