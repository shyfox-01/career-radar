import path from "node:path";

const SUPPORTED_MESSAGE = "Supported formats: PDF, DOCX, TXT, and Markdown";
const MAX_RESUME_BYTES = 10 * 1024 * 1024;

function normalizeText(text) {
  return String(text)
    .replaceAll("\u0000", "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\t ]+\n/gu, "\n")
    .trim();
}

export async function extractResume({ filename, bytes }) {
  if (typeof filename !== "string" || !filename.trim()) {
    throw new TypeError(SUPPORTED_MESSAGE);
  }
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new TypeError("Resume contents must be bytes");
  }
  const buffer = Buffer.from(bytes);
  if (buffer.length === 0) throw new TypeError("Resume file is empty");
  if (buffer.length > MAX_RESUME_BYTES) {
    throw new RangeError("Resume file must be 10 MB or smaller");
  }

  const extension = path.extname(filename).toLocaleLowerCase("en");
  let text;
  if (extension === ".txt" || extension === ".md") {
    text = buffer.toString("utf8");
  } else if (extension === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (extension === ".docx") {
    const { default: mammoth } = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else {
    throw new TypeError(SUPPORTED_MESSAGE);
  }

  const normalized = normalizeText(text);
  if (!normalized) throw new TypeError("No readable resume text was found");
  return {
    originalFilename: path.basename(filename),
    kind: extension.slice(1),
    text: normalized,
    byteLength: buffer.length,
  };
}
