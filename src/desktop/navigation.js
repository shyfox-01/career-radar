export function classifyNavigation(target, appOrigin) {
  let targetUrl;
  let originUrl;
  try {
    targetUrl = new URL(target);
    originUrl = new URL(appOrigin);
  } catch {
    return "blocked";
  }

  if (targetUrl.origin === originUrl.origin) return "internal";
  if (targetUrl.protocol === "https:" || targetUrl.protocol === "http:") {
    return "external";
  }
  return "blocked";
}
