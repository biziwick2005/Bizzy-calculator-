/* =========================================================================
   Bizzy Calculator — Expression Engine
   A small hand-written tokenizer + recursive-descent parser + evaluator.
   No eval() / new Function() — every symbol is interpreted explicitly so
   behaviour (angle mode, factorial, implicit multiplication, etc.) is
   fully controlled.
   ========================================================================= */

class CalcError extends Error {}

const FUNCTIONS = new Set([
  "sin", "cos", "tan", "asin", "acos", "atan",
  "log", "ln", "sqrt", "cbrt", "tenpow", "epow", "abs"
]);

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E
};

function tokenize(input) {
  const src = input
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\s+/g, "");

  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const numStr = src.slice(i, j);
      if ((numStr.match(/\./g) || []).length > 1) {
        throw new CalcError("Malformed number");
      }
      tokens.push({ type: "NUM", value: parseFloat(numStr) });
      i = j;
      continue;
    }

    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const word = src.slice(i, j);
      if (FUNCTIONS.has(word)) {
        tokens.push({ type: "FN", value: word });
      } else if (Object.prototype.hasOwnProperty.call(CONSTANTS, word)) {
        tokens.push({ type: "CONST", value: word });
      } else if (word === "Ans") {
        tokens.push({ type: "ANS" });
      } else {
        throw new CalcError(`Unknown token "${word}"`);
      }
      i = j;
      continue;
    }

    if ("+-*/^!()%".includes(ch)) {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    throw new CalcError(`Unexpected character "${ch}"`);
  }

  // ---- insert implicit multiplication -----------------------------------
  // e.g.  2(3+4)  ->  2*(3+4)
  //       2pi     ->  2*pi
  //       )(      ->  )*(
  //       2sin(   ->  2*sin(
  //       5!2     ->  5!*2
  const out = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (k > 0) {
      const prev = tokens[k - 1];
      const prevEndsValue =
        prev.type === "NUM" ||
        prev.type === "CONST" ||
        prev.type === "ANS" ||
        (prev.type === "OP" && (prev.value === ")" || prev.value === "!"));
      const curStartsValue =
        t.type === "NUM" ||
        t.type === "CONST" ||
        t.type === "ANS" ||
        t.type === "FN" ||
        (t.type === "OP" && t.value === "(");
      if (prevEndsValue && curStartsValue) {
        out.push({ type: "OP", value: "*" });
      }
    }
    out.push(t);
  }

  return out;
}

class Parser {
  constructor(tokens, ctx) {
    this.tokens = tokens;
    this.pos = 0;
    this.ctx = ctx; // { angleMode, ans }
  }

  peek() { return this.tokens[this.pos]; }
  next() { return this.tokens[this.pos++]; }

  expectOp(val) {
    const t = this.next();
    if (!t || t.type !== "OP" || t.value !== val) {
      throw new CalcError(`Expected "${val}"`);
    }
  }

  parse() {
    if (this.tokens.length === 0) return 0;
    const value = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new CalcError("Unexpected trailing input");
    }
    return value;
  }

  // expression := term (('+'|'-') term)*
  parseExpression() {
    let value = this.parseTerm();
    while (true) {
      const t = this.peek();
      if (t && t.type === "OP" && (t.value === "+" || t.value === "-")) {
        this.next();
        const rhs = this.parseTerm();
        value = t.value === "+" ? value + rhs : value - rhs;
      } else break;
    }
    return value;
  }

  // term := power (('*'|'/') power)*
  parseTerm() {
    let value = this.parsePower();
    while (true) {
      const t = this.peek();
      if (t && t.type === "OP" && (t.value === "*" || t.value === "/")) {
        this.next();
        const rhs = this.parsePower();
        if (t.value === "*") value *= rhs;
        else {
          if (rhs === 0) throw new CalcError("Division by zero");
          value /= rhs;
        }
      } else break;
    }
    return value;
  }

  // power := unary ('^' power)?   (right associative)
  parsePower() {
    const base = this.parseUnary();
    const t = this.peek();
    if (t && t.type === "OP" && t.value === "^") {
      this.next();
      const exponent = this.parsePower();
      return Math.pow(base, exponent);
    }
    return base;
  }

  // unary := ('-'|'+')* postfix
  parseUnary() {
    const t = this.peek();
    if (t && t.type === "OP" && (t.value === "-" || t.value === "+")) {
      this.next();
      const value = this.parseUnary();
      return t.value === "-" ? -value : value;
    }
    return this.parsePostfix();
  }

  // postfix := primary ('!' | '%')*
  parsePostfix() {
    let value = this.parsePrimary();
    while (true) {
      const t = this.peek();
      if (t && t.type === "OP" && t.value === "!") {
        this.next();
        value = factorial(value);
      } else if (t && t.type === "OP" && t.value === "%") {
        this.next();
        value = value / 100;
      } else break;
    }
    return value;
  }

  // primary := NUM | CONST | ANS | FN '(' expression ')' | '(' expression ')'
  parsePrimary() {
    const t = this.next();
    if (!t) throw new CalcError("Unexpected end of expression");

    if (t.type === "NUM") return t.value;
    if (t.type === "CONST") return CONSTANTS[t.value];
    if (t.type === "ANS") return this.ctx.ans ?? 0;

    if (t.type === "FN") {
      this.expectOp("(");
      const arg = this.parseExpression();
      this.expectOp(")");
      return applyFunction(t.value, arg, this.ctx.angleMode);
    }

    if (t.type === "OP" && t.value === "(") {
      const value = this.parseExpression();
      this.expectOp(")");
      return value;
    }

    throw new CalcError("Unexpected token");
  }
}

function factorial(n) {
  if (n < 0 || Math.floor(n) !== n) {
    throw new CalcError("x! requires a non-negative integer");
  }
  if (n > 170) throw new CalcError("Overflow");
  let result = 1;
  for (let k = 2; k <= n; k++) result *= k;
  return result;
}

function toRad(x, angleMode) {
  return angleMode === "DEG" ? (x * Math.PI) / 180 : x;
}
function fromRad(x, angleMode) {
  return angleMode === "DEG" ? (x * 180) / Math.PI : x;
}

function applyFunction(name, x, angleMode) {
  switch (name) {
    case "sin": return Math.sin(toRad(x, angleMode));
    case "cos": return Math.cos(toRad(x, angleMode));
    case "tan": return Math.tan(toRad(x, angleMode));
    case "asin": return fromRad(Math.asin(x), angleMode);
    case "acos": return fromRad(Math.acos(x), angleMode);
    case "atan": return fromRad(Math.atan(x), angleMode);
    case "log": return Math.log10(x);
    case "ln": return Math.log(x);
    case "sqrt":
      if (x < 0) throw new CalcError("√ of negative number");
      return Math.sqrt(x);
    case "cbrt": return Math.cbrt(x);
    case "tenpow": return Math.pow(10, x);
    case "epow": return Math.exp(x);
    case "abs": return Math.abs(x);
    default: throw new CalcError("Unknown function");
  }
}

/**
 * Evaluate a display-string expression.
 * @param {string} expr   the raw expression as shown on screen
 * @param {{angleMode: "DEG"|"RAD", ans: number}} ctx
 * @returns {number}
 */
function evaluateExpression(expr, ctx) {
  const tokens = tokenize(expr);
  const parser = new Parser(tokens, ctx);
  const result = parser.parse();
  if (typeof result !== "number" || Number.isNaN(result) || !Number.isFinite(result)) {
    throw new CalcError("Math error");
  }
  return result;
}

// Exposed to app.js
window.BizzyEngine = { evaluateExpression, CalcError };
