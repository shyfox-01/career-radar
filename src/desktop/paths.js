import path from "node:path";

export function resolveDesktopDataRoot({ configuredRoot, portableDirectory, userDataDirectory }) {
  if (configuredRoot) return path.resolve(configuredRoot);
  if (portableDirectory) {
    return path.join(path.resolve(portableDirectory), "CareerRadarData");
  }
  if (!userDataDirectory) {
    throw new Error("A user data directory is required for installed builds.");
  }
  return path.join(path.resolve(userDataDirectory), "data");
}
