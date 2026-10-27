// A query containing "internship" is not proof that every returned vacancy is an internship.
export function classifyJobType(title, labels = "") {
  if (/\bintern(?:ship)?\b|实习|實習/i.test(title)) return "internship";
  if (/\binternship\b|实习|實習/i.test(labels)) return "internship";
  if (/\bpart[ -]?time\b|兼职|兼職/i.test(labels)) return "part_time";
  if (/\bfull[ -]?time\b|全职|全職/i.test(labels)) return "full_time";
  return "unknown";
}
