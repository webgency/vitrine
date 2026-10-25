import type { Metadata } from "next";
import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import AlertAction from "@/components/AlertAction";
import { ALERT_TYPE_LABELS } from "@/lib/alert-status";
import { getAlertState } from "@/lib/alert-store";
import {
  ALERT_TYPES,
  FRESH_OFFER_DISCOUNT,
  PRICE_DROP_THRESHOLD,
  isTypeEnabled,
  visibleAlerts,
  type AlertEvent,
  type AlertType,
} from "@/lib/alerts.mjs";
import { IS_STATIC } from "@/lib/config";
import { formatDate, formatMoney } from "@/lib/format";
import { getWatches } from "@/lib/store";
import type { Watch } from "@/lib/types";

export const metadata: Metadata = { title: "Alerts" };

const TYPE_LABEL = ALERT_TYPE_LABELS;

const TYPE_RULE: Record<AlertType, string> = {
  target_met: "A dated ask or your tracked price reaches your target. Setting a target doesn't fire one.",
  price_drop: `A listing's ask falls ${PRICE_DROP_THRESHOLD * 100}% or more below its highest recorded ask since the last drop alert.`,
  fresh_offer: `A new dated ask, or one confirmed again after going stale, on wishlist watches not marked Pass. A new-condition ask ${FRESH_OFFER_DISCOUNT * 100}% or more under the tracked price is marked as a discount.`,
};

// A listed price is what the retailer shows, so it is never called landed.
const BASIS_NOTE = {
  listed: "Listed price, before shipping and duty",
  tracked: "Your tracked price",
  "all-in": "All-in price, with shipping and duty",
} as const;

function timeAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function AlertBody({ event }: { event: AlertEvent }) {
  const p = event.payload;
  if (event.type === "target_met") {
    return (
      <>
        {p.basis === "tracked" ? "Tracked price" : p.basis === "all-in" ? "All-in price" : "Best dated ask"}{" "}
        <strong className="tabular-nums">{formatMoney(p.price)}</strong> is at or below your target of{" "}
        <span className="tabular-nums">{formatMoney(p.target)}</span>.
      </>
    );
  }
  if (event.type === "price_drop") {
    return (
      <>
        Ask now <strong className="tabular-nums">{formatMoney(p.price)}</strong>, down{" "}
        {Math.round((p.dropPct ?? 0) * 1000) / 10}% from <span className="tabular-nums">{formatMoney(p.previousPrice)}</span>
        {p.previousAsOf && ` on ${formatDate(p.previousAsOf)}`}.
      </>
    );
  }
  return (
    <>
      {p.kind === "back" ? "Ask confirmed again after going stale: " : "New dated ask: "}
      <strong className="tabular-nums">{formatMoney(p.price)}</strong>
      {p.belowTrackedPct !== undefined && p.trackedPrice ? (
        <>
          , <strong>{Math.round(p.belowTrackedPct * 1000) / 10}% below</strong> your tracked{" "}
          <span className="tabular-nums">{formatMoney(p.trackedPrice)}</span>.
        </>
      ) : "."}
    </>
  );
}

function AlertCard({ event, watch, now }: { event: AlertEvent; watch?: Watch; now: Date }) {
  const p = event.payload;
  const cite = [p.source, p.condition, `as of ${formatDate(p.asOf)}`].filter(Boolean).join(" · ");

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-cocoa-900">
          {/* Espresso, like the nav badge: pink is reserved for the selected page. */}
          {!event.read && (
            <span className="mr-2 inline-block h-2 w-2 rounded-full bg-cocoa-900 align-middle">
              <span className="sr-only">Unread: </span>
            </span>
          )}
          {TYPE_LABEL[event.type]} ·{" "}
          {watch ? (
            <Link href={`/watch/${watch.id}`} className="hover:underline">
              {p.watch}
            </Link>
          ) : (
            p.watch
          )}
        </p>
        {/* The published copy is built once, so a relative time would go stale there. */}
        <span className="text-xs text-cocoa-400">{IS_STATIC ? formatDate(event.createdAt) : timeAgo(event.createdAt, now)}</span>
      </div>
      <p className="mt-1 text-sm text-cocoa-700">
        <AlertBody event={event} />
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-cocoa-500">
        <p>
          {cite}
          {p.basis && ` · ${BASIS_NOTE[p.basis]}`}
          {p.url && (
            <>
              {" · "}
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-azalea-700 hover:underline">
                Listing ↗
              </a>
            </>
          )}
        </p>
        {!IS_STATIC && (
          <AlertAction
            body={{ action: "mute", watchId: event.watchId, muted: true }}
            className="text-xs font-medium text-cocoa-400 hover:text-cocoa-700 hover:underline"
          >
            Mute this watch
          </AlertAction>
        )}
      </div>
    </li>
  );
}

export default async function AlertsPage() {
  if (!IS_STATIC) noStore();
  const [state, watches] = await Promise.all([getAlertState(), getWatches()]);
  const byId = new Map(watches.map((watch) => [watch.id, watch]));
  const events = visibleAlerts(state);
  const unread = events.filter((event) => !event.read).length;
  const now = new Date();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
          <p className="text-sm text-cocoa-500">Targets met, asks that dropped, and fresh offers, each with its source and date.</p>
        </div>
        {!IS_STATIC && unread > 0 && (
          <AlertAction body={{ action: "mark-read" }} className="btn-secondary h-9 rounded-full px-4 text-sm">
            Mark all read
          </AlertAction>
        )}
      </div>

      {events.length === 0 ? (
        <section className="card p-5 text-sm text-cocoa-500">
          No alerts yet. They appear when an edit or a price refresh moves something: a target met, an ask down{" "}
          {PRICE_DROP_THRESHOLD * 100}% or more, or a fresh offer on a wishlist watch you haven&apos;t marked Pass.
        </section>
      ) : (
        <ul className="space-y-3">
          {events.map((event) => (
            <AlertCard key={event.id} event={event} watch={byId.get(event.watchId)} now={now} />
          ))}
        </ul>
      )}

      <p className="text-xs text-cocoa-400">
        Alerts compare asking prices. They never report a sale price that hasn&apos;t been recorded.
      </p>

      <section id="alert-settings" aria-labelledby="alert-settings-heading" className="card scroll-mt-6 p-5">
        <h2 id="alert-settings-heading" className="text-base font-semibold text-cocoa-900">
          Alert settings
        </h2>
        <ul className="mt-2 divide-y divide-cocoa-100">
          {ALERT_TYPES.map((type) => {
            const enabled = isTypeEnabled(state, type);
            return (
              <li key={type} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cocoa-800">{TYPE_LABEL[type]}</p>
                  <p className="text-xs text-cocoa-500">{TYPE_RULE[type]}</p>
                </div>
                {IS_STATIC ? (
                  <span className="text-xs font-semibold text-cocoa-500">{enabled ? "On" : "Off"}</span>
                ) : (
                  <AlertAction
                    body={{ action: "type", type, enabled: !enabled }}
                    pressed={enabled}
                    className={`h-8 w-14 rounded-full text-xs font-semibold ${
                      enabled ? "bg-azalea text-cocoa-950" : "bg-cocoa-100 text-cocoa-600"
                    }`}
                  >
                    {enabled ? "On" : "Off"}
                  </AlertAction>
                )}
              </li>
            );
          })}
        </ul>

        {state.muted.length > 0 && (
          <div className="mt-3 border-t border-cocoa-100 pt-3">
            <h3 className="text-sm font-semibold text-cocoa-800">Muted watches</h3>
            <ul className="mt-1 divide-y divide-cocoa-100">
              {state.muted.map((id) => {
                const watch = byId.get(id);
                return (
                  <li key={id} className="flex items-center justify-between gap-2 py-2 text-sm text-cocoa-700">
                    <span>{watch ? `${watch.brand} ${watch.model}` : id}</span>
                    {!IS_STATIC && (
                      <AlertAction
                        body={{ action: "mute", watchId: id, muted: false }}
                        className="text-xs font-medium text-azalea-700 hover:underline"
                      >
                        Unmute
                      </AlertAction>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
