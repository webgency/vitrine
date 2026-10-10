import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "./notify-targets.mjs";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((fn) => fn()));
});

async function fixtureFiles(price = 375) {
  const directory = await mkdtemp(join(tmpdir(), "watch-notify-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const dataPath = join(directory, "watches.json");
  const statePath = join(directory, "notify-state.json");
  await writeFile(dataPath, JSON.stringify([{
    id: "synthetic-watch",
    brand: "Example",
    model: "Diver",
    status: "wishlist",
    targetPrice: { amount: 400, currency: "USD" },
    links: [{
      url: "https://retailer.example/diver",
      retailer: "Example Retailer",
      price: { amount: price, currency: "USD" },
      condition: "new",
      observedAt: "2026-09-09T12:00:00Z",
    }],
    specs: {},
    tags: [],
    dateAdded: "2026-01-01T00:00:00Z",
  }]));
  return { dataPath, statePath };
}

function webhookTransport() {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(null, { status: 204 });
  };
  return { requests, fetchImpl, url: "https://hooks.example/target" };
}

describe("notify-targets CLI", () => {
  it("posts a clear webhook and suppresses an identical repeat", async () => {
    const { dataPath, statePath } = await fixtureFiles();
    const webhook = webhookTransport();
    const env = {
      WATCH_NOTIFY_WEBHOOK_URL: webhook.url,
      WATCH_APP_BASE_URL: "https://webgency.github.io/vitrine",
    };
    const args = [`--data=${dataPath}`, `--state=${statePath}`, "--now=2026-09-10T12:00:00Z"];

    const dependencies = { env, fetchImpl: webhook.fetchImpl, logger: { log() {} } };
    await expect(run(args, dependencies)).resolves.toMatchObject({ sent: 1 });
    expect(webhook.requests).toHaveLength(1);
    expect(webhook.requests[0].url).toBe(webhook.url);
    expect(webhook.requests[0].body).toMatchObject({
      event: "watch-target-met",
      watch: { id: "synthetic-watch", brand: "Example", model: "Diver" },
      target: { amount: 400, currency: "USD" },
      hits: [expect.objectContaining({ trigger: "best-offer", source: "Example Retailer", condition: "new", ageDays: 1 })],
    });
    expect((webhook.requests[0].body as { text: string }).text).toContain("https://retailer.example/diver");
    expect((webhook.requests[0].body as { text: string }).text).toContain("/watch/synthetic-watch");

    await expect(run(args, dependencies)).resolves.toMatchObject({ sent: 0, pending: 0 });
    expect(webhook.requests).toHaveLength(1);
    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(Object.keys(state.sent)).toEqual(["v1:synthetic-watch:best-offer:USD:375"]);
  });

  it("lists a dry-run hit without sending or writing state", async () => {
    const { dataPath, statePath } = await fixtureFiles();
    const webhook = webhookTransport();
    const lines: string[] = [];

    await expect(run([
      `--data=${dataPath}`,
      `--state=${statePath}`,
      "--now=2026-09-10T12:00:00Z",
      "--dry",
    ], {
      env: { WATCH_NOTIFY_WEBHOOK_URL: webhook.url },
      fetchImpl: webhook.fetchImpl,
      logger: { log(message: string) { lines.push(message); } },
    })).resolves.toMatchObject({ sent: 0, pending: 1 });

    expect(lines.join("\n")).toContain("[would notify]");
    expect(lines.join("\n")).toContain("Example Diver");
    expect(webhook.requests).toHaveLength(0);
    await expect(readFile(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not send an expired offer unless explicitly included", async () => {
    const { dataPath, statePath } = await fixtureFiles();
    const watches = JSON.parse(await readFile(dataPath, "utf8"));
    watches[0].links[0].observedAt = "2026-01-01T00:00:00Z";
    await writeFile(dataPath, JSON.stringify(watches));
    const webhook = webhookTransport();
    const baseArgs = [`--data=${dataPath}`, `--state=${statePath}`, "--now=2026-09-10T12:00:00Z"];
    const dependencies = {
      env: { WATCH_NOTIFY_WEBHOOK_URL: webhook.url },
      fetchImpl: webhook.fetchImpl,
      logger: { log() {} },
    };

    await expect(run(baseArgs, dependencies)).resolves.toMatchObject({ sent: 0 });
    expect(webhook.requests).toHaveLength(0);
    await expect(run([...baseArgs, "--include-stale"], dependencies)).resolves.toMatchObject({ sent: 1 });
    expect(webhook.requests).toHaveLength(1);
  });
});
