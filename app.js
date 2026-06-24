/* =========================================================================
   Bizzy Calculator — App Controller
   ========================================================================= */

(() => {
  "use strict";

  /* ---------------------------------------------------------------------
     1. BOOT / WELCOME SEQUENCE
     --------------------------------------------------------------------- */
  const bootEl = document.getElementById("boot");
  const bootLogEl = document.getElementById("bootLog");
  const bootBarFill = document.getElementById("bootBarFill");
  const bootSkip = document.getElementById("bootSkip");
  const appEl = document.getElementById("app");

  const BOOT_LINES = [
    "> INITIALIZING BIZZY-OS KERNEL ...",
    "> LOADING SCIENTIFIC MATRIX  [ sin cos tan log ∫ ] ...",
    "> CALIBRATING NEON DISPLAY DRIVERS ...",
    "> SYNCING MEMORY BANKS ... OK",
    "> WELCOME TO BIZZY CALCULATOR"
  ];

  let bootTimers = [];
  let bootFinished = false;

  function typeLine(lineIndex, charIndex) {
    if (bootFinished) return;
    const line = BOOT_LINES[lineIndex];
    if (charIndex === 0) bootLogEl.textContent += (lineIndex === 0 ? "" : "\n");
    if (charIndex <= line.length) {
      bootLogEl.textContent += line[charIndex - 1] || "";
      const delay = lineIndex === BOOT_LINES.length - 1 ? 28 : 12;
      bootTimers.push(setTimeout(() => typeLine(lineIndex, charIndex + 1), delay));
    } else if (lineIndex < BOOT_LINES.length - 1) {
      bootTimers.push(setTimeout(() => typeLine(lineIndex + 1, 0), 90));
    } else {
      bootTimers.push(setTimeout(finishBoot, 650));
    }
  }

  // progress bar driven by overall estimated duration
  const BOOT_TOTAL_MS = 2400;
  const bootStart = performance.now();
  function tickBar() {
    if (bootFinished) return;
    const elapsed = performance.now() - bootStart;
    const pct = Math.min(100, (elapsed / BOOT_TOTAL_MS) * 100);
    bootBarFill.style.width = pct + "%";
    if (pct < 100) bootTimers.push(setTimeout(tickBar, 40));
  }

  function finishBoot() {
    if (bootFinished) return;
    bootFinished = true;
    bootTimers.forEach(clearTimeout);
    bootBarFill.style.width = "100%";
    bootEl.classList.add("boot--leaving");
    appEl.classList.add("app--visible");
    appEl.removeAttribute("aria-hidden");
    setTimeout(() => {
      bootEl.style.display = "none";
    }, 480);
  }

  bootSkip.addEventListener("click", finishBoot);
  typeLine(0, 0);
  tickBar();
  // safety net: never trap the user on the boot screen
  bootTimers.push(setTimeout(finishBoot, 6000));

  /* ---------------------------------------------------------------------
     2. CALCULATOR STATE
     --------------------------------------------------------------------- */
  const { evaluateExpression, CalcError } = window.BizzyEngine;

  const exprLine = document.getElementById("exprLine");
  const resultLine = document.getElementById("resultLine");
  const historyTape = document.getElementById("historyTape");
  const ledShift = document.getElementById("ledShift");
  const ledInv = document.getElementById("ledInv");
  const ledDeg = document.getElementById("ledDeg");
  const ledMem = document.getElementById("ledMem");
  const screen = document.querySelector(".screen");

  const state = {
    expr: "",
    angleMode: "DEG",
    shift: false,
    memory: 0,
    ans: 0,
    justEvaluated: false,
    history: [],
    tapeOpen: false
  };

  function formatNumber(n) {
    if (!Number.isFinite(n)) return "Error";
    if (Object.is(n, -0)) n = 0;
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) {
      return n.toExponential(6).replace(/(\.\d*?)0+e/, "$1e").replace(/\.e/, "e");
    }
    if (Number.isInteger(n)) return n.toString();
    let s = n.toPrecision(12);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }

  function render({ animateResult = false } = {}) {
    exprLine.textContent = state.expr.length ? state.expr : "0";

    // live preview
    if (!state.justEvaluated) {
      try {
        if (state.expr.trim().length) {
          const preview = evaluateExpression(state.expr, { angleMode: state.angleMode, ans: state.ans });
          resultLine.textContent = "= " + formatNumber(preview);
          resultLine.classList.remove("screen__result--error");
        } else {
          resultLine.textContent = "\u00A0";
        }
      } catch {
        resultLine.textContent = "\u00A0";
      }
    }

    ledShift.classList.toggle("led--on", state.shift);
    ledInv.classList.toggle("led--on", state.shift);
    ledDeg.textContent = state.angleMode;
    ledDeg.classList.add("led--on");
    ledMem.classList.toggle("led--on", state.memory !== 0);

    // update SHIFT-able key labels
    document.querySelectorAll("[data-base-label]").forEach((btn) => {
      btn.textContent = state.shift
        ? btn.getAttribute("data-shift-label")
        : btn.getAttribute("data-base-label");
    });
    document.getElementById("btnShift").classList.toggle("key--active", state.shift);

    renderTape();

    if (animateResult) {
      resultLine.classList.remove("pulse");
      // restart animation
      void resultLine.offsetWidth;
      resultLine.classList.add("pulse");
    }
  }

  function renderTape() {
    historyTape.classList.toggle("screen__tape--open", state.tapeOpen);
    if (!state.tapeOpen) return;
    if (state.history.length === 0) {
      historyTape.innerHTML = '<div class="tape__empty">No calculations yet</div>';
      return;
    }
    historyTape.innerHTML = state.history
      .slice(-6)
      .reverse()
      .map(
        (h) =>
          `<div class="tape__row"><span class="tape__expr">${escapeHtml(h.expr)}</span><span class="tape__eq">=</span><span class="tape__val">${escapeHtml(h.result)}</span></div>`
      )
      .join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function flashError(message) {
    resultLine.textContent = message || "Error";
    resultLine.classList.add("screen__result--error");
    screen.classList.remove("screen--shake");
    void screen.offsetWidth;
    screen.classList.add("screen--shake");
  }

  /* ---------------------------------------------------------------------
     3. INPUT HANDLERS
     --------------------------------------------------------------------- */
  function appendToExpr(str) {
    if (state.justEvaluated) {
      // decide: digits/decimal/constants/functions/paren-open start fresh,
      // operators & postfix continue chaining from the previous answer
      const continuesChain = /^[+\-*/×÷^!%)]/.test(str);
      state.expr = continuesChain ? formatNumber(state.ans) + str : str;
      state.justEvaluated = false;
    } else {
      state.expr += str;
    }
  }

  function pressNumber(d) {
    appendToExpr(d);
    render();
  }

  function pressOp(op) {
    appendToExpr(op);
    render();
  }

  function pressDecimal() {
    appendToExpr(".");
    render();
  }

  function pressFunction(btn) {
    const fn = state.shift ? btn.dataset.shiftFn : btn.dataset.fn;
    appendToExpr(fn + "(");
    render();
  }

  function wrapWholeExpr(before, after) {
    const current = state.expr.length ? state.expr : formatNumber(state.ans);
    state.expr = before + current + after;
    state.justEvaluated = false;
    render();
  }

  function doEquals() {
    if (!state.expr.trim().length) return;
    try {
      const result = evaluateExpression(state.expr, { angleMode: state.angleMode, ans: state.ans });
      const formatted = formatNumber(result);
      state.history.push({ expr: state.expr, result: formatted });
      state.ans = result;
      resultLine.classList.remove("screen__result--error");
      resultLine.textContent = "= " + formatted;
      state.expr = formatted;
      state.justEvaluated = true;
      render({ animateResult: true });
    } catch (err) {
      flashError(err instanceof CalcError ? err.message : "Error");
    }
  }

  function clearAll() {
    state.expr = "";
    state.justEvaluated = false;
    resultLine.classList.remove("screen__result--error");
    render();
  }

  function del() {
    if (state.justEvaluated) {
      state.expr = "";
      state.justEvaluated = false;
    } else {
      state.expr = state.expr.slice(0, -1);
    }
    render();
  }

  function toggleShift() {
    state.shift = !state.shift;
    render();
  }

  function toggleAngleMode() {
    state.angleMode = state.angleMode === "DEG" ? "RAD" : "DEG";
    render();
  }

  function toggleTape() {
    state.tapeOpen = !state.tapeOpen;
    render();
  }

  function memClear() { state.memory = 0; render(); }
  function memRecall() { appendToExpr(formatNumber(state.memory)); render(); }
  function memAdjust(sign) {
    try {
      const v = evaluateExpression(state.expr.length ? state.expr : formatNumber(state.ans), {
        angleMode: state.angleMode,
        ans: state.ans
      });
      state.memory += sign * v;
      render();
    } catch {
      flashError("Error");
    }
  }
  function insertAns() { appendToExpr("Ans"); render(); }

  /* ---------------------------------------------------------------------
     4. WIRE UP BUTTONS
     --------------------------------------------------------------------- */
  document.querySelectorAll(".key").forEach((btn) => {
    btn.addEventListener("click", () => {
      vibrateTap();
      spawnRipple(btn);

      if (btn.dataset.num !== undefined) return pressNumber(btn.dataset.num);
      if (btn.dataset.op !== undefined) return pressOp(btn.dataset.op);
      if (btn.dataset.fn !== undefined) return pressFunction(btn);

      const action = (state.shift && btn.dataset.shiftAction) || btn.dataset.action;
      switch (action) {
        case "decimal": return pressDecimal();
        case "equals": return doEquals();
        case "clear-all": return clearAll();
        case "del": return del();
        case "shift": return toggleShift();
        case "mode-toggle": return toggleAngleMode();
        case "toggle-tape": return toggleTape();
        case "mc": return memClear();
        case "mr": return memRecall();
        case "m-plus": return memAdjust(1);
        case "m-minus": return memAdjust(-1);
        case "ans": return insertAns();
        case "paren-open": return pressOp("(");
        case "paren-close": return pressOp(")");
        case "power": return pressOp("^");
        case "square": return wrapWholeExpr("(", ")^2");
        case "inv": return wrapWholeExpr("1/(", ")");
        case "pi": return pressOp("pi");
        case "e": return pressOp("e");
        case "factorial": return pressOp("!");
        case "percent": return pressOp("%");
        case "exp": return pressOp("*10^");
        case "negate":
          if (/^-\(.*\)$/.test(state.expr)) {
            state.expr = state.expr.slice(2, -1);
            render();
          } else {
            wrapWholeExpr("-(", ")");
          }
          return;
        default: return;
      }
    });
  });

  function vibrateTap() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  function spawnRipple(btn) {
    const r = document.createElement("span");
    r.className = "ripple";
    btn.appendChild(r);
    r.addEventListener("animationend", () => r.remove());
  }

  /* ---------------------------------------------------------------------
     5. KEYBOARD SUPPORT
     --------------------------------------------------------------------- */
  window.addEventListener("keydown", (e) => {
    if (bootEl.style.display !== "none") {
      if (e.key === "Enter" || e.key === " ") finishBoot();
      return;
    }
    if (/^[0-9]$/.test(e.key)) return pressNumber(e.key);
    if (e.key === ".") return pressDecimal();
    if (e.key === "+") return pressOp("+");
    if (e.key === "-") return pressOp("−");
    if (e.key === "*") return pressOp("×");
    if (e.key === "/") return pressOp("÷");
    if (e.key === "^") return pressOp("^");
    if (e.key === "(") return pressOp("(");
    if (e.key === ")") return pressOp(")");
    if (e.key === "%") return pressOp("%");
    if (e.key === "!") return pressOp("!");
    if (e.key === "Enter" || e.key === "=") { e.preventDefault(); return doEquals(); }
    if (e.key === "Backspace") return del();
    if (e.key === "Escape") return clearAll();
  });

  /* ---------------------------------------------------------------------
     6. PWA: SERVICE WORKER + INSTALL PROMPT
     --------------------------------------------------------------------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  let deferredInstallPrompt = null;
  const installHint = document.getElementById("installHint");

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installHint.classList.remove("hidden");
  });

  installHint.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installHint.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installHint.classList.add("hidden");
  });

  /* initial paint */
  render();
})();
