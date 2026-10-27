import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";

import { extractResume } from "../src/resume/extract.js";

async function makePdf(text) {
  const document = new PDFDocument({ autoFirstPage: true });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  document.text(text);
  document.end();
  await once(document, "end");
  return Buffer.concat(chunks);
}

async function makeDocx(text) {
  const document = new Document({
    sections: [{ children: [new Paragraph(text)] }],
  });
  return Packer.toBuffer(document);
}

test("extractResume reads TXT and Markdown as UTF-8", async () => {
  for (const filename of ["resume.txt", "resume.md"]) {
    const result = await extractResume({
      filename,
      bytes: Buffer.from("Fictional Candidate\nPython and SQL", "utf8"),
    });

    assert.equal(result.text, "Fictional Candidate\nPython and SQL");
    assert.equal(result.originalFilename, filename);
  }
});

test("extractResume rejects unsupported and empty files", async () => {
  await assert.rejects(
    () =>
      extractResume({
        filename: "resume.pages",
        bytes: Buffer.from("content"),
      }),
    /Supported formats: PDF, DOCX, TXT, and Markdown/,
  );
  await assert.rejects(
    () => extractResume({ filename: "resume.txt", bytes: Buffer.alloc(0) }),
    /Resume file is empty/,
  );
});

test("extractResume extracts readable text from a real PDF", async () => {
  const result = await extractResume({
    filename: "fictional-resume.pdf",
    bytes: await makePdf("Fictional Candidate PDF skill evidence"),
  });

  assert.match(result.text, /Fictional Candidate PDF skill evidence/);
  assert.equal(result.kind, "pdf");
});

test("extractResume extracts readable text from a real DOCX", async () => {
  const result = await extractResume({
    filename: "fictional-resume.docx",
    bytes: await makeDocx("Fictional Candidate DOCX skill evidence"),
  });

  assert.match(result.text, /Fictional Candidate DOCX skill evidence/);
  assert.equal(result.kind, "docx");
});
