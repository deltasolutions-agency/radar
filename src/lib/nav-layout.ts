// Disposizione del menu della dashboard: "top" (riquadri in alto, default) o
// "sidebar" (menu laterale classico). Scelta per browser, salvata in un cookie.
export const NAV_COOKIE = "radar_nav";
export type NavLayout = "top" | "sidebar";
export function parseNavLayout(v: string | undefined): NavLayout {
  return v === "sidebar" ? "sidebar" : "top";
}
