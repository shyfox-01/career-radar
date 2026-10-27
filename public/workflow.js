// Scroll tracking is independent of provider detection and other network requests.
const rail = document.querySelector(".route-rail");
const links = [...rail.querySelectorAll('a[href^="#"]')];
const sections = [...document.querySelectorAll(".desk > .panel[id]")];
let scheduled = false;
let activeId;

function updateWorkflow() {
  scheduled = false;
  const narrow = window.matchMedia("(max-width:900px)").matches;
  const headerHeight = document.querySelector(".masthead").getBoundingClientRect().height;
  const offset = headerHeight + (narrow ? rail.getBoundingClientRect().height : 0) + 24;
  document.documentElement.style.setProperty("--workflow-offset", `${offset}px`);
  let current = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= offset + 2) current = section;
  }
  if (
    window.scrollY > 0 &&
    window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
  ) {
    current = sections.at(-1);
  }
  const id = current.id === "preferences-panel" ? "profile-panel" : current.id;
  if (id === activeId) return;
  activeId = id;
  for (const link of links) {
    const active = link.hash === `#${id}`;
    link.closest("li").classList.toggle("active", active);
    if (active) {
      link.setAttribute("aria-current", "step");
      // Scroll only the horizontal rail, never move the user's page or keyboard focus.
      if (narrow)
        rail.scrollLeft = Math.max(
          0,
          link.offsetLeft - rail.clientWidth / 2 + link.offsetWidth / 2,
        );
    } else link.removeAttribute("aria-current");
  }
}
function scheduleUpdate() {
  if (!scheduled) {
    scheduled = true;
    requestAnimationFrame(updateWorkflow);
  }
}
window.addEventListener("scroll", scheduleUpdate, { passive: true });
window.addEventListener("resize", scheduleUpdate);
window.addEventListener("hashchange", scheduleUpdate);
const observer = new ResizeObserver(scheduleUpdate);
observer.observe(document.querySelector(".desk"));
observer.observe(rail);
updateWorkflow();
