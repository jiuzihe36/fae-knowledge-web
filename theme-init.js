/* 主题预置脚本：必须在 <head> 里同步执行（早于页面渲染），
   否则深色模式下会先闪一下白底再变黑。
   规则：白天（7:00–18:59）纯白、其余纯黑；用户手动选择优先。
   与 app.js 的 applyTheme 逻辑保持一致。 */
(function () {
  var KEY = "xs-theme";
  var mode = "auto";
  try {
    mode = window.localStorage.getItem(KEY) || "auto";
  } catch (e) { /* 隐私模式等，忽略 */ }

  var dark;
  if (mode === "dark") dark = true;
  else if (mode === "light") dark = false;
  else {
    var h = new Date().getHours();
    dark = (h < 7 || h >= 19);
  }
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
})();
