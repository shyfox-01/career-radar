// A job site can fire an automatic WebAuthn request as its login page loads. Windows
// then opens a modal passkey chooser above the form, which blocks keyboard input and
// reopens after it is cancelled, so email/password sign-in becomes impossible in an
// embedded window. These windows only ever need to carry a normal sign-in form, so the
// platform authenticator API is left out of them. Password credential management,
// which the same `navigator.credentials` object provides, is unaffected.
export function disablePlatformPasskeyPrompt(commandLine) {
  if (!commandLine?.appendSwitch)
    throw new TypeError("A command line with appendSwitch is required");
  commandLine.appendSwitch("disable-blink-features", "WebAuth");
}
