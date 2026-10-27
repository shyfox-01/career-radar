const PATTERNS = [
  {
    type: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
  },
  {
    type: "profile_url",
    pattern:
      /\b(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/in\/|github\.com\/)[A-Z0-9._~!$&'()*+,;=:@%/-]+/giu,
  },
  {
    type: "phone",
    pattern: /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{3,4}(?!\w)/gu,
  },
];

const ADDRESS_LINE =
  /^(?=.*\d)(?=.*\b(?:road|rd|street|st|avenue|ave|lane|ln|drive|dr|boulevard|blvd|路|街|道|巷|弄|号)\b).*$/iu;

export function redactResume(text) {
  if (typeof text !== "string") {
    throw new TypeError("Resume text must be a string");
  }

  const findings = [];
  const lines = text.split(/\r?\n/u).map((line) => {
    if (ADDRESS_LINE.test(line)) {
      findings.push({ type: "address", preview: "[REDACTED ADDRESS]" });
      return "[REDACTED ADDRESS]";
    }

    let redacted = line;
    for (const { type, pattern } of PATTERNS) {
      redacted = redacted.replace(pattern, () => {
        findings.push({ type, preview: `[REDACTED ${type.toUpperCase()}]` });
        return `[REDACTED ${type.toUpperCase()}]`;
      });
    }
    return redacted;
  });

  return { text: lines.join("\n"), findings };
}
