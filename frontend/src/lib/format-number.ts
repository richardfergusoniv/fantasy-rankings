/**
 * Locale-aware display for scores, projections, and percentages.
 *
 * Digits are rounded with `toFixed` first so the decimal places stay the same
 * as the previous display. `Intl.NumberFormat` then applies grouping and the
 * locale's separators and signs.
 *
 * Percentages in this app are already on a 0–100 scale, so the helper appends
 * "%" instead of using `style: "percent"` (which would multiply by 100).
 */

export type DecimalSign = "auto" | "always" | "exceptZero";

export type FormatDecimalOptions = {
  locale?: string;
  sign?: DecimalSign;
};

type SignDisplay = "auto" | "always" | "exceptZero";

const formatters = new Map<string, Intl.NumberFormat>();

function signDisplayFor(sign: DecimalSign, magnitudeIsZero: boolean): SignDisplay {
  switch (sign) {
    case "always":
      return "always";
    case "exceptZero":
      return magnitudeIsZero ? "auto" : "exceptZero";
    case "auto":
      return "auto";
    default: {
      const unreachable: never = sign;
      return unreachable;
    }
  }
}

function formatterFor(locale: string | undefined, decimals: number, signDisplay: SignDisplay): Intl.NumberFormat {
  const key = `${locale ?? ""}|${decimals}|${signDisplay}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
    signDisplay,
  });
  formatters.set(key, created);
  return created;
}

export function formatDecimal(value: number, decimals: number, options: FormatDecimalOptions = {}): string {
  if (!Number.isFinite(value)) return value.toFixed(decimals);
  const fixed = value.toFixed(decimals);
  const negative = fixed.startsWith("-");
  const unsigned = negative ? fixed.slice(1) : fixed;
  const magnitude = Number(unsigned);
  const signed = negative ? -magnitude : magnitude;
  const sign = options.sign ?? "auto";
  return formatterFor(options.locale, decimals, signDisplayFor(sign, magnitude === 0)).format(signed);
}

export function formatPoints(value: number | null, decimals = 1, options?: FormatDecimalOptions): string {
  if (value === null) return "—";
  return formatDecimal(value, decimals, options);
}

/** A 0–100 percentage with exactly one decimal, such as 68.0%. */
export function formatPercent(value: number, options?: FormatDecimalOptions): string {
  return `${formatDecimal(value, 1, options)}%`;
}

/** A 0–100 percentage rounded to a whole number, such as 42%. */
export function formatWholePercent(value: number, options?: FormatDecimalOptions): string {
  return `${formatDecimal(value, 0, options)}%`;
}
