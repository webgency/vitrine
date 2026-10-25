// In-app market alerts: what fires, when, and how repeats are held back.
//
// Plain .mjs so the app's store and scripts/enrich-watches.mjs (bare Node)
// apply one rule. Pure: no file access here; see alert-file.mjs.
//
// Alerts fire on change, never on read. Every refresh re-dates every link, so
// a feed computed from current data could not tell a new offer from a
// re-checked one. Comparing a watch before and after a write can.

import { freshnessForAge, normalizeMoneyToUsd, observationAgeDays } from "./offer-signals.mjs";
import { detectTargetNotification } from "./target-notifications.mjs";

/** @typedef {{ amount: number, currency: string }} Money */
/** @typedef {"target_met" | "price_drop" | "fresh_offer"} AlertType */
/**
 * @typedef {object} AlertPayload
 * @property {string} watch Brand and model, so an alert still reads after the watch is deleted.
 * @property {Money} price
 * @property {number} priceUsd
 * @property {string} asOf When the cited price was observed.
 * @property {string} [source]
 * @property {string} [url]
 * @property {string} [condition]
 * @property {"listed" | "tracked" | "all-in"} [basis]
 * @property {Money} [target]
 * @property {Money} [previousPrice]
 * @property {string} [previousAsOf]
 * @property {number} [dropPct]
 * @property {"new" | "back"} [kind]
 * @property {number} [belowTrackedPct] Fresh offer only: how far a new-condition ask sits under the tracked price.
 * @property {Money} [trackedPrice] The tracked price belowTrackedPct is measured from.
 */
/** @typedef {{ id: string, watchId: string, type: AlertType, createdAt: string, read?: boolean, payload: AlertPayload }} AlertEvent */
/** @typedef {{ version: 1, settings: { types: Partial<Record<AlertType, boolean>> }, muted: string[], events: AlertEvent[] }} AlertState */
/** @typedef {{ type: AlertType, watchId: string, payload: AlertPayload }} AlertCandidate */

/** @type {AlertType[]} */
export const ALERT_TYPES = ["target_met", "price_drop", "fresh_offer"];

/** PRD default. Measured from the highest ask since the last drop alert. */
export const PRICE_DROP_THRESHOLD = 0.05;

/**
 * Fresh offers for every wishlist watch not marked pass. With priority reduced
 * to shortlist / watching / pass, "watching" means exactly the watches whose
 * new offers are worth hearing about. An unset tier counts as watching, as the
 * migration and the add form treat it.
 */
export const FRESH_OFFER_TIERS = ["shortlist", "watching"];

/** @param {{ status?: string, wishlistTier?: string }} watch */
export function watchesForFreshOffers(watch) {
  return watch.status === "wishlist" && FRESH_OFFER_TIERS.includes(watch.wishlistTier ?? "watching");
}

/**
 * A fresh offer this far or more under the tracked price says so. A drop alert
 * needs a listing's own earlier ask to fall from, so a dealer that first
 * appears already discounted was announced as a plain new ask. Only a
 * new-condition ask is compared: a pre-owned ask under a new price is the
 * normal state of the market, not a deal (one owned watch's resale ask sat 47%
 * under its tracked price).
 */
export const FRESH_OFFER_DISCOUNT = 0.10;

export const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** The log is for recent news, not an archive; the oldest events fall off. */
export const MAX_ALERT_EVENTS = 200;

/** @returns {AlertState} */
export function emptyAlertState() {
  return { version: 1, settings: { types: {} }, muted: [], events: [] };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameMoney(a, b) {
  if (!a || !b) return a === b;
  return a.amount === b.amount && String(a.currency).trim().toUpperCase() === String(b.currency).trim().toUpperCase();
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function watchLabel(watch) {
  return `${watch.brand ?? ""} ${watch.model ?? ""}`.trim() || watch.id;
}

function linkSource(link) {
  if (link.retailer?.trim()) return link.retailer.trim();
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function linksByUrl(watch) {
  return new Map((watch?.links ?? []).map((link) => [link.url.trim(), link]));
}

function cheapest(candidates) {
  return [...candidates].sort((a, b) => a.payload.priceUsd - b.payload.priceUsd)[0];
}

function latestEvent(events, predicate) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (predicate(events[i])) return events[i];
  }
  return undefined;
}

function bestHit(detection) {
  if (detection.status !== "actionable") return undefined;
  return [...detection.hits].sort((a, b) => a.priceUsd - b.priceUsd)[0];
}

function targetMet(before, after, now) {
  if (!after.targetPrice) return undefined;
  // Setting or changing a target is the collector's own act, not market news.
  // Only a price or offer moving against an unchanged target fires.
  if (!sameMoney(before.targetPrice, after.targetPrice)) return undefined;

  const hit = bestHit(detectTargetNotification(after, { now }));
  if (!hit) return undefined;
  // Already met at this price or better before the write: nothing new.
  const prior = bestHit(detectTargetNotification(before, { now }));
  if (prior && prior.priceUsd <= hit.priceUsd) return undefined;

  return {
    type: "target_met",
    watchId: after.id,
    payload: compact({
      watch: watchLabel(after),
      price: hit.price,
      priceUsd: hit.priceUsd,
      asOf: hit.observedAt,
      basis: hit.basis,
      target: after.targetPrice,
      source: hit.source,
      url: hit.url,
      condition: hit.condition,
    }),
  };
}

function priceDrops(before, after, events) {
  const beforeLinks = linksByUrl(before);
  const found = [];

  for (const link of after.links ?? []) {
    const trail = link.askHistory ?? [];
    if (trail.length < 2) continue;
    // Only a move recorded by this write can fire; an old drop already had its chance.
    if (trail.length <= (beforeLinks.get(link.url.trim())?.askHistory?.length ?? 0)) continue;

    const newest = trail[trail.length - 1];
    const newestUsd = normalizeMoneyToUsd(newest.price);
    if (newestUsd === undefined) continue;

    // Measure from the highest ask since the last drop alert for this listing,
    // or since first recorded. Comparing only with the previous step would
    // let a run of small cuts never add up, and would measure a cut that
    // follows a rise from the wrong place.
    const lastAlert = latestEvent(
      events,
      (event) => event.type === "price_drop" && event.watchId === after.id && event.payload.url === link.url
    );
    const since = lastAlert ? new Date(lastAlert.payload.asOf).getTime() : -Infinity;
    let peak;
    let peakUsd = -Infinity;
    for (const snapshot of trail.slice(0, -1)) {
      if (new Date(snapshot.date).getTime() < since) continue;
      const usd = normalizeMoneyToUsd(snapshot.price);
      if (usd !== undefined && usd > peakUsd) {
        peak = snapshot;
        peakUsd = usd;
      }
    }
    if (!peak) continue;

    const dropPct = (peakUsd - newestUsd) / peakUsd;
    if (dropPct < PRICE_DROP_THRESHOLD) continue;

    found.push({
      type: "price_drop",
      watchId: after.id,
      payload: compact({
        watch: watchLabel(after),
        price: newest.price,
        priceUsd: newestUsd,
        asOf: newest.date,
        basis: "listed",
        previousPrice: peak.price,
        previousAsOf: peak.date,
        dropPct: Math.round(dropPct * 10000) / 10000,
        source: linkSource(link),
        url: link.url,
        condition: link.condition,
      }),
    });
  }
  return found;
}

function freshOffers(before, after, now) {
  if (!watchesForFreshOffers(after)) return [];
  const beforeLinks = linksByUrl(before);
  const found = [];

  for (const link of after.links ?? []) {
    if (!link.price || !link.observedAt) continue;
    const ageDays = observationAgeDays(link.observedAt, now);
    const priceUsd = normalizeMoneyToUsd(link.price);
    if (ageDays === undefined || priceUsd === undefined || freshnessForAge(ageDays) !== "fresh") continue;

    const previous = beforeLinks.get(link.url.trim());
    let kind;
    if (!previous?.price || !previous.observedAt) {
      kind = "new";
    } else {
      // Re-confirming an aging ask is routine; only one that had gone stale
      // (over 30 days) coming back is news.
      const previousAge = observationAgeDays(previous.observedAt, now);
      const previousTier = previousAge === undefined ? undefined : freshnessForAge(previousAge);
      if (previousTier !== "stale" && previousTier !== "expired") continue;
      kind = "back";
    }

    // Measured from the tracked price before this write: a refresh can move
    // the headline to the very ask being announced, which would read as 0%.
    const tracked = before.price ?? after.price;
    const trackedUsd = normalizeMoneyToUsd(tracked);
    const belowTracked = link.condition === "new" && trackedUsd ? (trackedUsd - priceUsd) / trackedUsd : undefined;
    const discounted = belowTracked !== undefined && belowTracked >= FRESH_OFFER_DISCOUNT;

    found.push({
      type: "fresh_offer",
      watchId: after.id,
      payload: compact({
        watch: watchLabel(after),
        price: link.price,
        priceUsd,
        asOf: link.observedAt,
        basis: "listed",
        kind,
        belowTrackedPct: discounted ? Math.round(belowTracked * 10000) / 10000 : undefined,
        trackedPrice: discounted ? tracked : undefined,
        source: linkSource(link),
        url: link.url,
        condition: link.condition,
      }),
    });
  }
  return found;
}

/**
 * What one write to a watch should announce: at most one candidate per type,
 * the cheapest when several listings qualify. `events` is the existing log,
 * used to measure drops from the last drop alert.
 *
 * @param {import("./types").Watch | undefined} before
 * @param {import("./types").Watch} after
 * @param {{ now?: Date, events?: AlertEvent[] }} [options]
 * @returns {AlertCandidate[]}
 */
export function detectAlerts(before, after, options = {}) {
  // A newly added watch is the collector's own entry, not a market change.
  if (!before) return [];
  const now = options.now ?? new Date();
  const events = options.events ?? [];

  return [
    targetMet(before, after, now),
    cheapest(priceDrops(before, after, events)),
    cheapest(freshOffers(before, after, now)),
  ].filter(Boolean);
}

/**
 * @param {AlertState} state
 * @param {AlertType} type
 */
export function isTypeEnabled(state, type) {
  return state.settings?.types?.[type] !== false;
}

/**
 * Add candidates to the log. Muted watches and switched-off types record
 * nothing. One alert per watch and type per 24 hours, unless the new price is
 * lower than the last one announced.
 *
 * @param {AlertState} state
 * @param {AlertCandidate[]} candidates
 * @param {Date} [now]
 * @returns {{ state: AlertState, added: AlertEvent[] }}
 */
export function appendAlerts(state, candidates, now = new Date()) {
  const events = [...state.events];
  /** @type {AlertEvent[]} */
  const added = [];

  for (const candidate of candidates) {
    if (!isTypeEnabled(state, candidate.type) || state.muted.includes(candidate.watchId)) continue;
    const last = latestEvent(events, (event) => event.watchId === candidate.watchId && event.type === candidate.type);
    const recent = last && now.getTime() - new Date(last.createdAt).getTime() < DEDUPE_WINDOW_MS;
    if (recent && !(candidate.payload.priceUsd < last.payload.priceUsd)) continue;

    /** @type {AlertEvent} */
    const event = {
      id: `${candidate.type}-${candidate.watchId}-${now.getTime().toString(36)}`,
      watchId: candidate.watchId,
      type: candidate.type,
      createdAt: now.toISOString(),
      payload: candidate.payload,
    };
    events.push(event);
    added.push(event);
  }

  if (!added.length) return { state, added };
  return { state: { ...state, events: events.slice(-MAX_ALERT_EVENTS) }, added };
}

/**
 * Events to show, newest first, without muted watches or switched-off types.
 * @param {AlertState} state
 */
export function visibleAlerts(state) {
  return [...state.events]
    .reverse()
    .filter((event) => isTypeEnabled(state, event.type) && !state.muted.includes(event.watchId));
}

/** @param {AlertState} state */
export function alertSummary(state) {
  const visible = visibleAlerts(state);
  return { total: visible.length, unread: visible.filter((event) => !event.read).length };
}

/**
 * @param {AlertState} state
 * @param {string[]} [ids] every visible event when omitted
 * @returns {AlertState}
 */
export function markAlertsRead(state, ids) {
  const visible = new Set(visibleAlerts(state).map((event) => event.id));
  return {
    ...state,
    events: state.events.map((event) =>
      (ids ? ids.includes(event.id) : visible.has(event.id)) ? { ...event, read: true } : event
    ),
  };
}

/**
 * @param {AlertState} state
 * @param {string} watchId
 * @param {boolean} muted
 * @returns {AlertState}
 */
export function setWatchMuted(state, watchId, muted) {
  const others = state.muted.filter((id) => id !== watchId);
  return { ...state, muted: muted ? [...others, watchId] : others };
}

/**
 * @param {AlertState} state
 * @param {AlertType} type
 * @param {boolean} enabled
 * @returns {AlertState}
 */
export function setAlertTypeEnabled(state, type, enabled) {
  return { ...state, settings: { ...state.settings, types: { ...state.settings.types, [type]: enabled } } };
}

function isMoney(value) {
  return isRecord(value) && Number.isFinite(value.amount) && typeof value.currency === "string" && value.currency.trim() !== "";
}

function isDate(value) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/**
 * Problems with an alerts file, as readable strings. Shared by the app's
 * reader and scripts/validate-data.mjs.
 * @param {unknown} value
 * @returns {string[]}
 */
export function alertStateErrors(value) {
  if (!isRecord(value)) return ["alerts must be an object"];
  const errors = [];
  if (value.version !== 1) errors.push("alerts.version must be 1");

  if (value.settings !== undefined) {
    if (!isRecord(value.settings)) errors.push("alerts.settings must be an object");
    else if (value.settings.types !== undefined) {
      if (!isRecord(value.settings.types)) errors.push("alerts.settings.types must be an object");
      else {
        for (const [type, enabled] of Object.entries(value.settings.types)) {
          if (!ALERT_TYPES.includes(type)) errors.push(`alerts.settings.types.${type} is not an alert type`);
          if (typeof enabled !== "boolean") errors.push(`alerts.settings.types.${type} must be true or false`);
        }
      }
    }
  }

  if (value.muted !== undefined && !(Array.isArray(value.muted) && value.muted.every((id) => typeof id === "string"))) {
    errors.push("alerts.muted must be an array of watch ids");
  }

  if (!Array.isArray(value.events)) {
    errors.push("alerts.events must be an array");
    return errors;
  }
  value.events.forEach((event, index) => {
    const path = `alerts.events[${index}]`;
    if (!isRecord(event)) return errors.push(`${path} must be an object`);
    if (typeof event.id !== "string" || !event.id) errors.push(`${path}.id is required`);
    if (typeof event.watchId !== "string" || !event.watchId) errors.push(`${path}.watchId is required`);
    if (!ALERT_TYPES.includes(event.type)) errors.push(`${path}.type must be one of ${ALERT_TYPES.join(", ")}`);
    if (!isDate(event.createdAt)) errors.push(`${path}.createdAt must be a valid date`);
    if (event.read !== undefined && typeof event.read !== "boolean") errors.push(`${path}.read must be true or false`);
    // Every alert cites what it saw and when; one without that can't be checked.
    if (!isRecord(event.payload)) return errors.push(`${path}.payload is required`);
    if (typeof event.payload.watch !== "string") errors.push(`${path}.payload.watch is required`);
    if (!isMoney(event.payload.price)) errors.push(`${path}.payload.price is required`);
    if (!Number.isFinite(event.payload.priceUsd)) errors.push(`${path}.payload.priceUsd is required`);
    if (!isDate(event.payload.asOf)) errors.push(`${path}.payload.asOf must be a valid date`);
  });
  return errors;
}

/**
 * A valid alerts file with optional sections filled in.
 * @param {any} value already checked by alertStateErrors
 * @returns {AlertState}
 */
export function normalizeAlertState(value) {
  return {
    version: 1,
    settings: { types: { ...(value.settings?.types ?? {}) } },
    muted: [...(value.muted ?? [])],
    events: value.events,
  };
}
