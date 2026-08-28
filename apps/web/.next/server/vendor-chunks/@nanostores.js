"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@nanostores";
exports.ids = ["vendor-chunks/@nanostores"];
exports.modules = {

/***/ "(ssr)/../../node_modules/@nanostores/react/index.js":
/*!*****************************************************!*\
  !*** ../../node_modules/@nanostores/react/index.js ***!
  \*****************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   useStore: () => (/* binding */ useStore)\n/* harmony export */ });\n/* harmony import */ var nanostores__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! nanostores */ \"(ssr)/../../node_modules/nanostores/listen-keys/index.js\");\n/* harmony import */ var react__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! react */ \"(ssr)/../../node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js\");\n\n\n\nlet emit = (snapshotRef, onChange) => value => {\n  if (snapshotRef.current === value) return\n  snapshotRef.current = value\n  onChange()\n}\n\nfunction useStore(store, { keys, deps = [store, keys], ssr } = {}) {\n  let snapshotRef = (0,react__WEBPACK_IMPORTED_MODULE_0__.useRef)()\n  snapshotRef.current = store.get()\n\n  let subscribe = (0,react__WEBPACK_IMPORTED_MODULE_0__.useCallback)(onChange => {\n    emit(snapshotRef, onChange)(store.value)\n\n    return keys?.length > 0\n      ? (0,nanostores__WEBPACK_IMPORTED_MODULE_1__.listenKeys)(store, keys, emit(snapshotRef, onChange))\n      : store.listen(emit(snapshotRef, onChange))\n  }, deps)\n\n  let get = () => snapshotRef.current\n\n  let server = get\n  if (ssr && 'init' in store) {\n    server = ssr === 'initial' ? () => store.init : ssr\n  }\n\n  return (0,react__WEBPACK_IMPORTED_MODULE_0__.useSyncExternalStore)(subscribe, get, server)\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHNzcikvLi4vLi4vbm9kZV9tb2R1bGVzL0BuYW5vc3RvcmVzL3JlYWN0L2luZGV4LmpzIiwibWFwcGluZ3MiOiI7Ozs7OztBQUF1QztBQUMwQjs7QUFFakU7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFTywyQkFBMkIsa0NBQWtDLElBQUk7QUFDeEUsb0JBQW9CLDZDQUFNO0FBQzFCOztBQUVBLGtCQUFrQixrREFBVztBQUM3Qjs7QUFFQTtBQUNBLFFBQVEsc0RBQVU7QUFDbEI7QUFDQSxHQUFHOztBQUVIOztBQUVBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLFNBQVMsMkRBQW9CO0FBQzdCIiwic291cmNlcyI6WyJDOlxcVXNlcnNcXHppc3VhblxcRGVza3RvcFxcbWVcXGhha2NhdGhvbiBzc1xcbXViYVxcbm9kZV9tb2R1bGVzXFxAbmFub3N0b3Jlc1xccmVhY3RcXGluZGV4LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGxpc3RlbktleXMgfSBmcm9tICduYW5vc3RvcmVzJ1xuaW1wb3J0IHsgdXNlQ2FsbGJhY2ssIHVzZVJlZiwgdXNlU3luY0V4dGVybmFsU3RvcmUgfSBmcm9tICdyZWFjdCdcblxubGV0IGVtaXQgPSAoc25hcHNob3RSZWYsIG9uQ2hhbmdlKSA9PiB2YWx1ZSA9PiB7XG4gIGlmIChzbmFwc2hvdFJlZi5jdXJyZW50ID09PSB2YWx1ZSkgcmV0dXJuXG4gIHNuYXBzaG90UmVmLmN1cnJlbnQgPSB2YWx1ZVxuICBvbkNoYW5nZSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1c2VTdG9yZShzdG9yZSwgeyBrZXlzLCBkZXBzID0gW3N0b3JlLCBrZXlzXSwgc3NyIH0gPSB7fSkge1xuICBsZXQgc25hcHNob3RSZWYgPSB1c2VSZWYoKVxuICBzbmFwc2hvdFJlZi5jdXJyZW50ID0gc3RvcmUuZ2V0KClcblxuICBsZXQgc3Vic2NyaWJlID0gdXNlQ2FsbGJhY2sob25DaGFuZ2UgPT4ge1xuICAgIGVtaXQoc25hcHNob3RSZWYsIG9uQ2hhbmdlKShzdG9yZS52YWx1ZSlcblxuICAgIHJldHVybiBrZXlzPy5sZW5ndGggPiAwXG4gICAgICA/IGxpc3RlbktleXMoc3RvcmUsIGtleXMsIGVtaXQoc25hcHNob3RSZWYsIG9uQ2hhbmdlKSlcbiAgICAgIDogc3RvcmUubGlzdGVuKGVtaXQoc25hcHNob3RSZWYsIG9uQ2hhbmdlKSlcbiAgfSwgZGVwcylcblxuICBsZXQgZ2V0ID0gKCkgPT4gc25hcHNob3RSZWYuY3VycmVudFxuXG4gIGxldCBzZXJ2ZXIgPSBnZXRcbiAgaWYgKHNzciAmJiAnaW5pdCcgaW4gc3RvcmUpIHtcbiAgICBzZXJ2ZXIgPSBzc3IgPT09ICdpbml0aWFsJyA/ICgpID0+IHN0b3JlLmluaXQgOiBzc3JcbiAgfVxuXG4gIHJldHVybiB1c2VTeW5jRXh0ZXJuYWxTdG9yZShzdWJzY3JpYmUsIGdldCwgc2VydmVyKVxufVxuIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6WzBdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(ssr)/../../node_modules/@nanostores/react/index.js\n");

/***/ })

};
;