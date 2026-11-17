import { parse } from "csv-parse/sync";
import { CSV_MAX_BYTES, CSV_MAX_DATA_ROWS } from "@guidesk/domain";
import type { FileProcessResponse } from "../protocol.js";

/**
 * The file processor's CSV mode (feature 002 US5, FR-038, research R10): UTF-8 with or without a
 * byte-order mark (Windows-1252 as a fallback, which spreadsheets in Spanish still write), comma
 * or semicolon chosen from the header line, `#` rows and blank rows left out, and at most 500
 * data rows and 2 MB. Cells are returned as text; the worker validates them.
 *
 * Cells can hold calendar links, which are restricted: nothing here logs or throws with them.
 */
export interface CsvLimits {
  maxBytes?: number;
  maxDataRows?: number;
}

/** Cells kept per row; a property row has 13 columns, and an error file 15. */
const MAX_COLUMNS = 50;
/** Longest cell kept; longer cells are cut and then fail length checks in the worker. */
const MAX_CELL_LENGTH = 4000;

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** Magic numbers of files people upload by mistake: spreadsheets, PDFs, images, archives. */
const BINARY_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], // ZIP, so .xlsx and .ods
  [0xd0, 0xcf, 0x11, 0xe0], // OLE, so .xls
  [0x25, 0x50, 0x44, 0x46], // PDF
  [0x89, 0x50, 0x4e, 0x47], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x1f, 0x8b], // gzip
  [0xff, 0xfe], // UTF-16 little-endian
  [0xfe, 0xff], // UTF-16 big-endian
];

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** True for content that is not text: a known signature, a NUL byte, or many control bytes. */
function looksBinary(bytes: Buffer): boolean {
  if (BINARY_SIGNATURES.some((signature) => startsWith(bytes, signature))) return true;
  let control = 0;
  for (const byte of bytes) {
    if (byte === 0) return true;
    if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f) {
      control += 1;
    }
  }
  return control > bytes.length / 100;
}

function decode(bytes: Buffer): string {
  const body = startsWith(bytes, UTF8_BOM) ? bytes.subarray(UTF8_BOM.length) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

const COMMENT_LINE = /^\s*"?\s*#/;
/** A line with something besides separators, quotes, and spaces. */
const CONTENT_LINE = /[^\s,;"]/;

function delimiterOf(lines: readonly string[]): ";" | "," {
  const header = lines.find((line) => CONTENT_LINE.test(line) && !COMMENT_LINE.test(line)) ?? "";
  const semicolons = header.split(";").length - 1;
  const commas = header.split(",").length - 1;
  return semicolons > commas ? ";" : ",";
}

function isSkipped(record: readonly string[]): boolean {
  const first = record[0]?.trimStart() ?? "";
  return first.startsWith("#") || record.every((cell) => cell.trim() === "");
}

/**
 * Parses one uploaded CSV file. The size, the type, and a rough line count are checked before
 * parsing; the exact row count after. The answer is the rows with their row numbers in the file,
 * counting the `#` and blank rows a spreadsheet shows, or an error code.
 */
export function parseCsvFile(bytes: Buffer, limits: CsvLimits = {}): FileProcessResponse {
  const maxBytes = limits.maxBytes ?? CSV_MAX_BYTES;
  const maxDataRows = limits.maxDataRows ?? CSV_MAX_DATA_ROWS;
  if (bytes.length > maxBytes) return { error: "too_large" };
  if (bytes.length === 0) return { error: "unreadable" };
  if (looksBinary(bytes)) return { error: "unsupported_type" };

  const text = decode(bytes);
  const lines = text.split(/\r\n|\n|\r/);
  // Quoted cells may span lines, so this only refuses files that cannot fit whatever they hold.
  const contentLines = lines.filter((line) => CONTENT_LINE.test(line) && !COMMENT_LINE.test(line));
  if (contentLines.length > (maxDataRows + 1) * 4) return { error: "too_many_rows" };

  let records: string[][];
  try {
    records = parse(text, {
      delimiter: delimiterOf(lines),
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    }) as string[][];
  } catch {
    // The parser's message can quote a cell, so only the code leaves.
    return { error: "unreadable" };
  }

  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  records.forEach((record, index) => {
    if (isSkipped(record)) return;
    rows.push(record.slice(0, MAX_COLUMNS).map((cell) => cell.slice(0, MAX_CELL_LENGTH)));
    rowNumbers.push(index + 1);
  });
  if (rows.length - 1 > maxDataRows) return { error: "too_many_rows" };
  return { rows, rowNumbers };
}
