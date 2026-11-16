/**
 * The expression of a derived field (`compute:`, specs/20261115-crm-offer-wizard AC-4.5, DD-18): numbers,
 * field names, `+`, `-`, parentheses and `sum(COLUMN)`, read by a hand-written recursive-descent parser. A
 * template author's text is never evaluated as code — there is no `eval` and no `Function` constructor, and
 * anything outside the grammar is refused (`parseCompute` returns null).
 *
 * Arithmetic is exact: values are decimals of at most 6 fractional digits, computed as scaled BigInts; the
 * result is the canonical decimal text ("30", "33.4", "-10"). An input that is missing or not a decimal makes
 * the result null (empty): a derived field with an empty input is empty, never wrong.
 *
 * Pure; no `Intl`, no clock.
 *
 * Shared with the CRM UI: byte-identical copy (group offerEngine.compute).
 */
// shared-copy:begin offerEngine.compute

export type ComputeExpr =
  | { readonly type: "num"; readonly scaled: bigint }
  | { readonly type: "name"; readonly name: string }
  | { readonly type: "sum"; readonly column: string }
  | { readonly type: "neg"; readonly operand: ComputeExpr }
  | { readonly type: "add" | "sub"; readonly left: ComputeExpr; readonly right: ComputeExpr };

export const MAX_COMPUTE_LENGTH = 200;
const MAX_PAREN_DEPTH = 16;
const SCALE_DIGITS = 6;
const SCALE = 1_000_000n;
const NAME = "[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9_]{0,39}";

/** A decimal text → scaled integer; null when it is not a plain decimal within the supported size. */
function toScaled(text: string): bigint | null {
  const match = /^(-?)(\d{1,15})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  const scaled = BigInt(match[2]!) * SCALE + BigInt((match[3] ?? "").padEnd(SCALE_DIGITS, "0"));
  return match[1] === "-" ? -scaled : scaled;
}

function fromScaled(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction === "" ? "" : `.${fraction}`}`;
}

export function parseCompute(source: string): ComputeExpr | null {
  if (source.length > MAX_COMPUTE_LENGTH || source.trim() === "") return null;
  let pos = 0;
  let depth = 0;
  let failed = false;

  const skip = () => {
    while (pos < source.length && source[pos] === " ") pos++;
  };
  const fail = (): null => {
    failed = true;
    return null;
  };

  function term(): ComputeExpr | null {
    skip();
    if (failed) return null;
    const ch = source[pos];
    if (ch === "-") {
      pos++;
      const operand = term();
      return operand ? { type: "neg", operand } : fail();
    }
    if (ch === "(") {
      if (depth >= MAX_PAREN_DEPTH) return fail();
      depth++;
      pos++;
      const inner = expression();
      skip();
      if (!inner || source[pos] !== ")") return fail();
      pos++;
      depth--;
      return inner;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(pos));
    if (number) {
      const scaled = toScaled(number[0]);
      if (scaled === null) return fail();
      pos += number[0].length;
      return { type: "num", scaled };
    }
    const sum = new RegExp(`^sum\\((${NAME})\\)`).exec(source.slice(pos));
    if (sum) {
      pos += sum[0].length;
      return { type: "sum", column: sum[1]! };
    }
    const name = new RegExp(`^${NAME}`).exec(source.slice(pos));
    if (name) {
      pos += name[0].length;
      return { type: "name", name: name[0] };
    }
    return fail();
  }

  function expression(): ComputeExpr | null {
    let left = term();
    if (!left) return null;
    for (;;) {
      skip();
      const op = source[pos];
      if (op !== "+" && op !== "-") return left;
      pos++;
      const right = term();
      if (!right) return null;
      left = { type: op === "+" ? "add" : "sub", left, right };
    }
  }

  const result = expression();
  skip();
  return failed || !result || pos !== source.length ? null : result;
}

/** The field names and the `sum()` columns an expression reads, each once, in text order. */
export function computeRefs(expr: ComputeExpr): { names: string[]; sums: string[] } {
  const names: string[] = [];
  const sums: string[] = [];
  const stack: ComputeExpr[] = [expr];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "name") {
      if (!names.includes(node.name)) names.push(node.name);
    } else if (node.type === "sum") {
      if (!sums.includes(node.column)) sums.push(node.column);
    } else if (node.type === "neg") {
      stack.push(node.operand);
    } else if (node.type === "add" || node.type === "sub") {
      stack.push(node.right, node.left);
    }
  }
  return { names, sums };
}

export interface ComputeEnv {
  /** A field's value (canonical decimal), null when empty. */
  value(name: string): string | number | null;
  /** The sum of a table column over its printed rows, null when it cannot be given. */
  sum(column: string): string | number | null;
}

/** The expression's value as a canonical decimal text; null when an input is empty or not a decimal. */
export function evaluateCompute(expr: ComputeExpr, env: ComputeEnv): string | null {
  const input = (raw: string | number | null): bigint | null => (raw === null ? null : toScaled(String(raw)));
  const run = (node: ComputeExpr): bigint | null => {
    switch (node.type) {
      case "num":
        return node.scaled;
      case "name":
        return input(env.value(node.name));
      case "sum":
        return input(env.sum(node.column));
      case "neg": {
        const operand = run(node.operand);
        return operand === null ? null : -operand;
      }
      case "add":
      case "sub": {
        const left = run(node.left);
        const right = run(node.right);
        if (left === null || right === null) return null;
        return node.type === "add" ? left + right : left - right;
      }
    }
  };
  const value = run(expr);
  return value === null ? null : fromScaled(value);
}
// shared-copy:end offerEngine.compute
