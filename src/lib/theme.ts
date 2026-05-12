import "@milkdown/crepe/theme/common/style.css";

const lightHref = new URL(
  "@milkdown/crepe/theme/frame.css",
  import.meta.url,
).href;
const darkHref = new URL(
  "@milkdown/crepe/theme/frame-dark.css",
  import.meta.url,
).href;

const LINK_ID = "crepe-theme";

function ensureLinkElement(): HTMLLinkElement {
  let link = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = LINK_ID;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  return link;
}

function applyTheme(isDark: boolean) {
  const link = ensureLinkElement();
  const next = isDark ? darkHref : lightHref;
  if (link.href !== next) link.href = next;
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
}

export function initTheme(): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  applyTheme(media.matches);
  const handler = (event: MediaQueryListEvent) => applyTheme(event.matches);
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
