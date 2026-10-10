import { Money } from "./types";
import { normalizePriceToUsd } from "./scoring";

function formatNativeMoney(money?: Money | null): string {
  if (!money || typeof money.amount !== "number" || Number.isNaN(money.amount)) {
    return "—";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: money.currency || "USD",
      maximumFractionDigits: 0,
    }).format(money.amount);
  } catch {
    return `${money.amount} ${money.currency ?? ""}`.trim();
  }
}

/**
 * Display a consistent USD comparison price while retaining the retailer's
 * original currency as context. Stored money is never rewritten, so exchange
 * rate updates can recalculate the USD display without corrupting history.
 */
export function formatMoney(money?: Money | null): string {
  if (!money || typeof money.amount !== "number" || Number.isNaN(money.amount)) return "—";
  const currency = money.currency.trim().toUpperCase();
  const original = formatNativeMoney({ ...money, currency });
  if (currency === "USD") return original;
  const usd = formatNativeMoney({ amount: normalizePriceToUsd(money), currency: "USD" });
  return `${usd} (${original})`;
}

// A bare "YYYY-MM-DD" names a day, not an instant. new Date() reads it as UTC
// midnight, which west of UTC is the evening before, so formatting it in the
// viewer's zone showed every date-only observedAt a day early. The watch form
// saves an untouched date back in this shape, so these are common.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    // Read the day back in the zone it was parsed in. Full timestamps are
    // instants and keep the viewer's local day.
    ...(DATE_ONLY.test(iso) ? { timeZone: "UTC" } : {}),
  });
}

export function formatAgeDays(ageDays: number): string {
  if (ageDays <= 0) return "today";
  return `${ageDays}d ago`;
}

/** Hostname only, for displaying a link compactly (e.g. "chrono24.com"). */
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * English ordinal ("1st", "22nd", "13th"). The teens are the exception — 11, 12
 * and 13 take "th" despite ending in 1, 2 and 3 — which is how the collection
 * card shipped "22th pct" from a bare `${n}th`.
 */
export function formatOrdinal(value: number): string {
  const n = Math.round(value);
  const lastTwo = Math.abs(n) % 100;
  const lastOne = Math.abs(n) % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : lastOne === 1
        ? "st"
        : lastOne === 2
          ? "nd"
          : lastOne === 3
            ? "rd"
            : "th";
  return `${n}${suffix}`;
}
