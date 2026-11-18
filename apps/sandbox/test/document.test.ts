import { describe, expect, it } from "vitest";
import { PDF_MAX_PAGES, readPdf } from "../src/file-processor/pdf.js";

/**
 * The `document` mode (feature 003 T104, research R9, AC-SEC-009): text PDFs read per page, page
 * and size limits, encrypted files refused, scanned pages read by recognition only behind the
 * flag, and files that are not PDFs refused by their magic bytes. Every PDF here is built by the
 * test from synthetic text.
 */
function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/** A minimal PDF: one page per entry, each with one line of Helvetica text (or none). */
function buildPdf(pages: (string | null)[], options: { encrypted?: boolean } = {}): Buffer {
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = objects.length + 1 + pages.length * 2;
  const kids: number[] = [];
  for (const text of pages) {
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapePdf(text)}) Tj ET` : "";
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  add(
    `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`,
  );
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const encrypt = options.encrypted
    ? add(
        `<< /Filter /Standard /V 1 /R 2 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -44 >>`,
      )
    : null;
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${
    encrypt ? ` /Encrypt ${encrypt} 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]` : ""
  } >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const recognizer = (text: string) => {
  const calls: Buffer[] = [];
  return {
    calls,
    recognize: async (image: Buffer) => {
      calls.push(image);
      return text;
    },
  };
};

describe("the document mode (T104)", () => {
  it("reads the text of each page", async () => {
    const pdf = buildPdf([
      "La lavadora usa el programa corto para toallas.",
      "El filtro se limpia una vez al mes con agua tibia.",
    ]);
    const result = await readPdf(pdf, { recognizer: recognizer(""), readScannedPages: false });
    expect(result).toMatchObject({ pages: 2, scannedPages: 0 });
    expect("text" in result && result.text).toContain("programa corto");
    expect("text" in result && result.text).toContain("filtro se limpia");
  });

  it(`refuses more than ${PDF_MAX_PAGES} pages`, async () => {
    const pdf = buildPdf(
      Array.from({ length: PDF_MAX_PAGES + 1 }, (_, n) => `Página ${n} del manual.`),
    );
    expect(await readPdf(pdf, { recognizer: recognizer(""), readScannedPages: false })).toEqual({
      error: "too_many_pages",
    });
  });

  it("refuses an encrypted PDF as password_protected", async () => {
    const pdf = buildPdf(["Contenido protegido del manual."], { encrypted: true });
    expect(await readPdf(pdf, { recognizer: recognizer(""), readScannedPages: false })).toEqual({
      error: "password_protected",
    });
  });

  it("reads scanned pages by recognition only behind the flag", async () => {
    const pdf = buildPdf([null, "Esta página sí tiene texto para leer."]);
    const off = recognizer("Texto reconocido del escaneo.");
    const without = await readPdf(pdf, { recognizer: off, readScannedPages: false });
    expect(without).toMatchObject({ pages: 2, scannedPages: 1 });
    expect(off.calls).toHaveLength(0);
    expect("text" in without && without.text).not.toContain("reconocido");

    const on = recognizer("Texto reconocido del escaneo.");
    const withFlag = await readPdf(pdf, { recognizer: on, readScannedPages: true });
    expect(withFlag).toMatchObject({ pages: 2, scannedPages: 1 });
    expect(on.calls).toHaveLength(1);
    expect(on.calls[0]!.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect("text" in withFlag && withFlag.text).toContain("reconocido");
  });

  it("refuses a renamed archive and other files by their magic bytes (AC-SEC-009)", async () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    expect(await readPdf(zip, { recognizer: recognizer(""), readScannedPages: false })).toEqual({
      error: "unsupported_type",
    });
    const fake = Buffer.from("%PDF-1.4 this is not really a pdf");
    expect(await readPdf(fake, { recognizer: recognizer(""), readScannedPages: false })).toEqual({
      error: "unreadable",
    });
  });

  it("refuses a file over 20 MB", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20 * 1024 * 1024)]);
    expect(await readPdf(big, { recognizer: recognizer(""), readScannedPages: false })).toEqual({
      error: "too_large",
    });
  });
});
