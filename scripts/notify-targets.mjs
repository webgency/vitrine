#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  detectTargetNotification,
  notificationKey,
} from "../src/lib/target-notifications.mjs";

const DEFAULT_DATA_PATH = fileURLToPath(new URL("../data/watches.json", import.meta.url));
const DEFAULT_STATE_PATH = fileURLToPath(new URL("../data/notify-state.json", import.meta.url));
const ENRICH_PATH = fileURLToPath(new URL("./enrich-watches.mjs", import.meta.url));
const DEFAULT_APP_BASE_URL = "https://webgency.github.io/vitrine";

function parseArgs(args) {
  const options = {
    dry: false,
    includeStale: false,
    refresh: false,
    ids: [],
    dataPath: DEFAULT_DATA_PATH,
    statePath: DEFAULT_STATE_PATH,
  };

  for (const arg of args) {
    if (arg === "--dry") options.dry = true;
    else if (arg === "--include-stale" || arg === "--include-expired") options.includeStale = true;
    else if (arg === "--refresh") options.refresh = true;
    else if (arg.startsWith("--id=")) options.ids.push(arg.slice(5));
    else if (arg.startsWith("--data=")) options.dataPath = resolve(arg.slice(7));
    else if (arg.startsWith("--state=")) options.statePath = resolve(arg.slice(8));
    else if (arg.startsWith("--now=")) options.now = new Date(arg.slice(6));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.now && Number.isNaN(options.now.getTime())) throw new Error("--now must be a valid date.");
  return options;
}

function formatMoney(money) {
  const currency = String(money.currency).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(money.amount);
  } catch {
    return `${money.amount} ${currency}`;
  }
}

function formatHit(hit) {
  const age = hit.ageDays === 0 ? "today" : `${hit.ageDays}d ago`;
  if (hit.trigger === "best-offer") {
    const condition = hit.condition ?? "condition unknown";
    return `best dated offer: ${formatMoney(hit.price)} from ${hit.source} (${condition}, ${age}, ${hit.freshness})`;
  }
  const label = hit.trigger === "landed" ? "all-in landed ask" : "tracked ask";
  return `${label}: ${formatMoney(hit.price)} (${age}, ${hit.freshness})`;
}

export function formatNotification(watch, detection, hits, appBaseUrl) {
  const lines = [
    `Target met: ${watch.brand} ${watch.model}`,
    `Target: ${formatMoney(detection.target)}`,
    ...hits.map((hit) => `• ${formatHit(hit)}`),
  ];
  const bestLink = hits.find((hit) => hit.trigger === "best-offer")?.url;
  const detailLink = appBaseUrl
    ? `${appBaseUrl.replace(/\/$/, "")}/watch/${encodeURIComponent(watch.id)}`
    : undefined;
  if (bestLink) lines.push(`Retailer: ${bestLink}`);
  if (detailLink) lines.push(`Watch detail: ${detailLink}`);
  return lines.join("\n");
}

async function loadState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed?.version !== 1 || !parsed.sent || typeof parsed.sent !== "object") {
      throw new Error("expected { version: 1, sent: {} }");
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, sent: {} };
    throw new Error(`Could not read notification state at ${path}: ${error.message}`);
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, path);
}

function webhookPayload(format, text, watch, detection, hits) {
  if (format === "slack") return { text };
  if (format === "discord") return { content: text };
  if (format !== "generic") throw new Error("WATCH_NOTIFY_WEBHOOK_FORMAT must be generic, slack, or discord.");
  return {
    event: "watch-target-met",
    text,
    watch: { id: watch.id, brand: watch.brand, model: watch.model },
    target: detection.target,
    hits,
  };
}

async function postWebhook(url, payload, fetchImpl) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
}

function runEnrich(options) {
  const enrichArgs = [ENRICH_PATH, "--refresh"];
  if (options.dry) enrichArgs.push("--dry");
  for (const id of options.ids) enrichArgs.push(`--id=${id}`);
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, enrichArgs, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`Enrichment exited with status ${code}.`)));
  });
}

/** Run the notifier. Dependency parameters keep webhook behavior testable. */
export async function run(args = process.argv.slice(2), dependencies = {}) {
  const options = parseArgs(args);
  const env = dependencies.env ?? process.env;
  const logger = dependencies.logger ?? console;
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const refreshRunner = dependencies.refreshRunner ?? runEnrich;

  if (options.refresh) await refreshRunner(options);

  const watches = JSON.parse(await readFile(options.dataPath, "utf8"));
  if (!Array.isArray(watches)) throw new Error(`${options.dataPath} must contain a watch array.`);
  const selected = options.ids.length ? watches.filter((watch) => options.ids.includes(watch.id)) : watches;
  const missingIds = options.ids.filter((id) => !watches.some((watch) => watch.id === id));
  if (missingIds.length) throw new Error(`Unknown watch id(s): ${missingIds.join(", ")}`);

  const state = await loadState(options.statePath);
  const now = options.now ?? new Date();
  const appBaseUrl = env.WATCH_APP_BASE_URL ?? DEFAULT_APP_BASE_URL;
  const pending = [];
  let metCount = 0;

  for (const watch of selected) {
    const detection = detectTargetNotification(watch, { now, includeStale: options.includeStale });
    if (detection.status !== "actionable") continue;
    metCount += detection.hits.length;
    const hits = detection.hits.filter((hit) => !state.sent[notificationKey(watch.id, hit)]);
    if (hits.length) pending.push({ watch, detection, hits });
  }

  if (!pending.length) {
    logger.log(metCount ? "No new target alerts; matching prices were already sent." : "No actionable target prices found.");
    return { sent: 0, pending: 0, deduplicated: metCount };
  }

  if (options.dry) {
    for (const item of pending) {
      logger.log(`[would notify]\n${formatNotification(item.watch, item.detection, item.hits, appBaseUrl)}`);
    }
    logger.log(`Dry run: ${pending.length} watch notification(s), nothing sent or recorded.`);
    return { sent: 0, pending: pending.length, deduplicated: metCount - pending.reduce((n, item) => n + item.hits.length, 0) };
  }

  const webhookUrl = env.WATCH_NOTIFY_WEBHOOK_URL;
  if (!webhookUrl) throw new Error("WATCH_NOTIFY_WEBHOOK_URL is required when new target alerts exist (or use --dry).");
  const format = (env.WATCH_NOTIFY_WEBHOOK_FORMAT ?? "generic").toLowerCase();
  let sent = 0;

  for (const item of pending) {
    const message = formatNotification(item.watch, item.detection, item.hits, appBaseUrl);
    await postWebhook(webhookUrl, webhookPayload(format, message, item.watch, item.detection, item.hits), fetchImpl);
    const sentAt = now.toISOString();
    for (const hit of item.hits) {
      state.sent[notificationKey(item.watch.id, hit)] = { sentAt };
    }
    await saveState(options.statePath, state);
    sent += 1;
    logger.log(`[sent] ${item.watch.brand} ${item.watch.model} (${item.hits.map((hit) => hit.trigger).join(", ")})`);
  }

  return { sent, pending: pending.length, deduplicated: metCount - pending.reduce((n, item) => n + item.hits.length, 0) };
}

const isDirect = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirect) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
