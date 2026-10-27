export function deriveProviderState({
  installed,
  authenticated,
  compatible = true,
  capabilities = {},
} = {}) {
  const state = !installed
    ? "missing"
    : !authenticated
      ? "signed_out"
      : !compatible || !capabilities.discovery
        ? "incompatible"
        : "ready";
  return {
    state,
    installed: Boolean(installed),
    authenticated: Boolean(authenticated),
    compatible: Boolean(compatible),
  };
}

export function validateProviderContract(provider) {
  if (!provider || typeof provider.id !== "string" || typeof provider.name !== "string")
    throw new TypeError("Provider needs an id and name");
  for (const method of ["detect", "status", "capabilities", "discover"]) {
    if (typeof provider[method] !== "function")
      throw new TypeError(`Provider must implement ${method}()`);
  }
  return provider;
}
