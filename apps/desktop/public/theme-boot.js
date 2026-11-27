/* global localStorage, matchMedia, document */
// Runs before first paint (external file: the CSP forbids inline scripts).
// Sets the theme from the last choice or the OS so the first frame is not the wrong theme.
try {
  var t = localStorage.getItem("utter.theme");
  var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  var e = document.documentElement;
  e.dataset.theme = dark ? "dark" : "light";
  e.classList.add(dark ? "dark" : "light");
} catch {
  /* appearance.ts applies the theme once the app boots */
}
