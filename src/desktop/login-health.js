// Only boolean page health and hostnames cross this boundary, never input values.
export const LOGIN_HEALTH_SCRIPT = String.raw`(() => {
  const body = document.body;
  const text = body?.innerText ?? '';
  return {
    blank: !text.trim() && !document.querySelector('input, button, iframe, canvas, img, svg'),
    unsupported: /disallowed_useragent|this browser or app may not be secure|此浏览器或应用可能不安全/i.test(text),
    failed: /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET|ERR_CONNECTION_TIMED_OUT/.test(text),
  };
})()`;

export function loginHost(target) {
  try {
    return new URL(target).hostname;
  } catch {
    return "";
  }
}

export function sourceLoginUrl(source) {
  if (source.id === "hk-ies") return "https://www1.jobs.gov.hk/0/en/jobseeker/login/";
  return ["sg-linkedin", "hk-linkedin"].includes(source.id)
    ? "https://www.linkedin.com/login"
    : source.searchUrl("");
}

export function loginFailure(code, target, networkCode = "") {
  const host = loginHost(target);
  const messages = {
    login_page_blank:
      "The login page stayed blank. Retry or return to direct sign-in. / 登录页持续空白，请重试或返回直接登录。",
    embedded_login_unsupported:
      "This provider does not support this embedded login window. Use LinkedIn email/password sign-in here. / 此身份提供方不支持内嵌登录，请在此使用 LinkedIn 邮箱和密码直接登录。",
    login_load_failed:
      "The login page could not load. Check the connection, then retry. / 登录页加载失败，请检查网络后重试。",
    login_renderer_gone:
      "The login window stopped responding. Reopen sign-in. / 登录窗口异常退出，请重新打开登录。",
    login_navigation_blocked:
      "This sign-in navigation could not stay in the source session. Return to direct sign-in. / 此次跳转无法保留在来源会话内，请返回直接登录。",
  };
  const safeCode = /^ERR_[A-Z_]+$/u.test(networkCode) ? networkCode : "";
  return {
    code,
    host,
    networkCode: safeCode,
    message: `${messages[code] ?? messages.login_load_failed}${host ? ` (${host})` : ""}${safeCode ? ` [${safeCode}]` : ""}`,
  };
}

export function attachLoginHealth({
  window,
  source,
  onFailure,
  recover,
  dialog,
  Menu,
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = clearTimeout,
}) {
  const contents = window.webContents;
  let timer;
  let generation = 0;
  let showing = false;
  let reported = "";
  const url = () => contents.getURL?.() ?? sourceLoginUrl(source);

  async function report(code, target = url(), networkCode = "") {
    const failure = loginFailure(code, target, networkCode);
    const signature = `${generation}:${failure.code}:${failure.host}`;
    if (reported === signature || window.isDestroyed()) return;
    reported = signature;
    await onFailure(failure);
    if (!dialog || showing || window.isDestroyed()) return;
    showing = true;
    try {
      const result = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Sign-in needs attention / 登录需要处理",
        message: failure.message,
        detail:
          "If Windows asks you to choose a passkey, cancel that dialog to type an email and password; it blocks typing while it is open. Google sign-in may reject embedded browsers, and a normal-browser login does not automatically connect this app. / 如果 Windows 弹出“选择通行密钥”，点取消即可输入邮箱和密码；该弹窗打开时会挡住键盘输入。Google 登录可能拒绝内嵌浏览器；在普通浏览器登录并不会自动连接本程序。",
        buttons: ["Direct sign-in / 直接登录", "Retry / 重试", "Close / 关闭提示"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      });
      if (!window.isDestroyed() && result.response < 2)
        await recover(result.response === 0 ? sourceLoginUrl(source) : null);
    } finally {
      showing = false;
    }
  }

  function reset() {
    generation += 1;
    if (timer) cancel(timer);
  }
  function safely(promise) {
    void promise.catch(() => {});
  }
  async function checkBlank(expected, second = false) {
    if (expected !== generation || window.isDestroyed() || !contents.executeJavaScript) return;
    const current = url();
    // Do not inspect application pages or arbitrary external destinations.
    const host = loginHost(current);
    const sourceHost = loginHost(source.evidenceUrl).replace(/^www\./u, "");
    if (
      current !== "about:blank" &&
      host !== "accounts.google.com" &&
      host !== sourceHost &&
      !host.endsWith(`.${sourceHost}`)
    )
      return;
    const health = await contents.executeJavaScript(LOGIN_HEALTH_SCRIPT);
    if (expected !== generation || window.isDestroyed()) return;
    if (health?.unsupported) return report("embedded_login_unsupported", current);
    if (health?.failed) return report("login_load_failed", current);
    if (health?.blank && second) return report("login_page_blank", current);
    if (health?.blank) timer = schedule(() => safely(checkBlank(expected, true)), 2000);
  }
  contents.on("did-start-navigation", (_event, _target, _inPlace, isMainFrame) => {
    if (isMainFrame !== false) reset();
  });
  contents.on("did-finish-load", () => {
    const expected = generation;
    timer = schedule(() => safely(checkBlank(expected)), 2000);
  });
  contents.on("did-fail-load", (_event, errorCode, description, target, isMainFrame) => {
    if (errorCode === -3 || isMainFrame === false) return; // Redirect/cancel is not a failed login.
    reset();
    safely(report("login_load_failed", target, description));
  });
  contents.on("render-process-gone", () => safely(report("login_renderer_gone")));
  window.on("closed", reset);
  if (Menu && window.setMenu) {
    window.setMenu(
      Menu.buildFromTemplate([
        {
          label: "Sign-in Help / 登录帮助",
          submenu: [
            {
              label: "Direct sign-in / 返回直接登录",
              click: () => safely(recover(sourceLoginUrl(source))),
            },
            { label: "Retry page / 重试页面", click: () => safely(recover(null)) },
          ],
        },
      ]),
    );
  }
  return { report };
}
