// A cap, interrupted page, or missing pagination evidence is never "all results read".
export async function scanPages({
  startUrl,
  readPage,
  maxPages = 20,
  shouldStop = () => false,
  onProgress = async () => {},
}) {
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100)
    throw new RangeError("maxPages must be 1–100");
  const jobs = new Map(),
    visited = new Set(),
    signatures = new Set();
  const scan = {
    pagesRead: 0,
    uniqueJobs: 0,
    complete: false,
    nextUrl: startUrl,
    stopReason: "running",
  };
  let capability;
  const result = () => ({ jobs: [...jobs.values()], scan: { ...scan }, capability });
  while (scan.nextUrl) {
    const url = scan.nextUrl;
    if (shouldStop()) {
      scan.stopReason = "cancelled";
      await onProgress(result());
      break;
    }
    if (visited.has(url)) {
      scan.stopReason = "pagination_loop";
      await onProgress(result());
      break;
    }
    visited.add(url);
    let page;
    try {
      page = await readPage(url);
    } catch (error) {
      capability = error.details?.capability ?? capability;
      scan.stopReason = error.code ?? "page_read_failed";
      await onProgress(result());
      break;
    }
    capability = page.capability ?? capability;
    for (const job of page.jobs ?? []) if (job.url) jobs.set(job.url, job);
    scan.uniqueJobs = jobs.size;
    scan.pagesRead += 1;
    scan.lastPageIncomplete = !page.completePage;
    const signature = (page.jobs ?? [])
      .map((job) => job.url)
      .sort()
      .join("\n");
    const repeated = signature && signatures.has(signature);
    if (signature) signatures.add(signature);
    scan.nextUrl = page.nextUrl ?? url;
    if (!page.completePage) {
      scan.nextUrl = url;
      scan.stopReason = page.stopReason ?? "page_incomplete";
    } else if (repeated || visited.has(page.nextUrl)) scan.stopReason = "pagination_loop";
    else if (!page.nextUrl && page.endConfirmed) {
      scan.complete = true;
      scan.nextUrl = null;
      scan.stopReason = "last_page";
    } else if (!page.nextUrl) scan.stopReason = "pagination_unavailable";
    else if (scan.pagesRead >= maxPages) scan.stopReason = "page_limit";
    await onProgress(result());
    if (scan.stopReason !== "running") break;
  }
  return result();
}
