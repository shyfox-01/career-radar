const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

function validDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

function normalizedEmploymentType(value) {
  const normalized = String(value ?? "")
    .toLocaleLowerCase("en")
    .replace(/[\s-]+/gu, "_");
  if (["intern", "internship", "实习"].includes(normalized)) return "internship";
  if (["full_time", "fulltime", "全职", "正式岗"].includes(normalized)) return "full_time";
  return null;
}

export function evaluateTimeline(job = {}, preferences = {}) {
  const employmentType = normalizedEmploymentType(job.employmentType);
  const durationLabel =
    typeof job.durationRequirement === "string"
      ? job.durationRequirement.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 200)
      : "";
  if (employmentType === "internship") {
    const start = validDate(job.startDate);
    const availableFrom = validDate(preferences.internshipAvailableFrom);

    if (start === null || availableFrom === null) {
      return {
        status: "date_unknown",
        reasons: ["Internship start or availability date is not stated"],
        durationLabel,
      };
    }
    if (start < availableFrom) {
      return {
        status: "advisory",
        reasons: ["Advertised internship start is before declared availability"],
        durationLabel,
      };
    }
    return {
      status: "eligible",
      reasons: ["Advertised internship start is on or after declared availability"],
      durationLabel,
    };
  }

  if (employmentType === "full_time") {
    return {
      status: "date_unknown",
      reasons: ["Full-time start arrangements are left for the user and employer"],
      durationLabel,
    };
  }

  return {
    status: "date_unknown",
    reasons: ["Employment type or explicit dates are not stated"],
    durationLabel,
  };
}
