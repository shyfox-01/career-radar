export function detectAtsFamily(value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLocaleLowerCase("en");
  } catch {
    return "generic";
  }
  if (hostname.endsWith("greenhouse.io")) return "greenhouse";
  if (hostname.endsWith("lever.co")) return "lever";
  if (hostname.includes("myworkdayjobs.com") || hostname.endsWith("workday.com")) return "workday";
  if (hostname.endsWith("smartrecruiters.com")) return "smartrecruiters";
  if (hostname.includes("successfactors.")) return "successfactors";
  return "generic";
}
