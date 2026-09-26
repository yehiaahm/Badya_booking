// Runs before the app loads so the first paint already has the right theme
// and reading direction (no flash of light mode or left-to-right layout).
(function () {
  var html = document.documentElement;
  try {
    var t = localStorage.getItem("bs-theme") || "system";
    var dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    html.dataset.theme = dark ? "dark" : "light";
  } catch (e) {}
  try {
    var l = localStorage.getItem("bs-lang");
    if (l === "ar" || (!l && (navigator.language || "").toLowerCase().indexOf("ar") === 0)) {
      html.lang = "ar";
      html.dir = "rtl";
    }
  } catch (e) {}
})();
