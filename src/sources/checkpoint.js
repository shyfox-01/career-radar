export function mergeScanProgress(prior, scan) {
  const unfinished = prior && !prior.complete;
  if (unfinished && scan.pagesRead === 0) {
    return {
      ...prior,
      ...scan,
      pagesRead: prior.pagesRead ?? 0,
      lastPageIncomplete: prior.lastPageIncomplete === true,
      nextUrl: scan.nextUrl ?? prior.nextUrl,
    };
  }
  const previousPages = unfinished
    ? (prior.pagesRead ?? 0) - (prior.lastPageIncomplete ? 1 : 0)
    : 0;
  return {
    ...scan,
    pagesRead: Math.max(0, previousPages) + scan.pagesRead,
    lastPageIncomplete: scan.lastPageIncomplete === true,
  };
}
