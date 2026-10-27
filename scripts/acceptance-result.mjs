// Developer acceptance only. Login, rows, pagination and complete inventory
// are independent evidence; finishing a queue never implies all four passed.
export function acceptanceNextAction(summary, choice) {
  if (choice === "retry" || choice === "skip") return choice;
  const blocked = (summary.reasons ?? []).some(
    (code) => !["page_limit", "scroll_limit"].includes(code),
  );
  return summary.reading === "passed" && !blocked ? "next" : "wait";
}

export function summarizeAcceptance(result = {}) {
  const jobs = result.jobs ?? [],
    scans = result.scans ?? [];
  const reasons = [...(result.failedTasks ?? []), ...(result.pendingTasks ?? [])].map(
    (item) => item.code,
  );
  const valid = jobs.filter((job) => {
    try {
      const url = new URL(job.url);
      return (
        Boolean(job.title?.trim()) && url.protocol === "https:" && !url.username && !url.password
      );
    } catch {
      return false;
    }
  });
  const fullInventory =
    scans.length > 0 &&
    scans.every((scan) => scan.complete === true) &&
    !(
      result.failedTasks?.length ||
      result.pendingTasks?.length ||
      result.unsupportedTaskIds?.length
    );
  let reading = valid.length ? "passed" : "failed";
  if (jobs.length !== valid.length) reading = "invalid_data";
  else if (!jobs.length) {
    if (reasons.includes("sign_in_required")) reading = "needs_login";
    else if (reasons.includes("challenge_required")) reading = "needs_verification";
    else if (result.unsupportedTaskIds?.length) reading = "unsupported";
    else if (fullInventory) reading = "empty_sample";
  }
  const badPaging = scans.some((scan) =>
    ["pagination_loop", "page_incomplete", "page_read_failed"].includes(scan.stopReason),
  );
  return {
    reading,
    validRows: valid.length,
    invalidRows: jobs.length - valid.length,
    pagination: badPaging
      ? "failed"
      : scans.some((scan) => scan.pagesRead >= 2)
        ? "passed"
        : fullInventory
          ? "terminal_sample"
          : "not_tested",
    fullInventory,
    reasons,
    scans,
  };
}
