import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePurchaseFields, purchaseRevision } from "./purchase-entry";
import { normalizeWatchPatch } from "./validation";

// Same isolation as store.test.ts: data/ resolves from process.cwd(), so each
// test mocks cwd and re-imports the module.
let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;
const privateFile = () => path.join(tempDir, "data", "private.json");

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-private-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  vi.resetModules();
});

afterEach(async () => {
  cwdSpy.mockRestore();
  vi.unstubAllEnvs();
  await fs.rm(tempDir, { recursive: true, force: true });
});

const paid = { price: { amount: 850, currency: "USD" }, date: "2025-06-01", source: "Tissot boutique" };

describe("private store", () => {
  it("treats a missing file as an empty store", async () => {
    const { getPrivateRecords, getPrivateRecord } = await import("./private-store");
    expect(await getPrivateRecords()).toEqual({});
    expect(await getPrivateRecord("w1")).toBeUndefined();
  });

  it("saves, reads back and clears a purchase, leaving no empty record", async () => {
    const { getPrivateRecord, savePurchase } = await import("./private-store");
    await savePurchase("w1", paid, purchaseRevision(undefined));
    expect(await getPrivateRecord("w1")).toEqual({ purchase: paid });

    await savePurchase("w1", undefined, purchaseRevision(paid));
    expect(JSON.parse(await fs.readFile(privateFile(), "utf-8"))).toEqual({});
  });

  it("refuses a stale draft", async () => {
    const { savePurchase, PurchaseConflictError } = await import("./private-store");
    await savePurchase("w1", paid, purchaseRevision(undefined));
    await expect(savePurchase("w1", { price: { amount: 1, currency: "USD" } }, purchaseRevision(undefined)))
      .rejects.toBeInstanceOf(PurchaseConflictError);
  });

  it("rejects a malformed file instead of guessing", async () => {
    await fs.mkdir(path.dirname(privateFile()), { recursive: true });
    await fs.writeFile(privateFile(), JSON.stringify({ w1: { purchase: { price: { amount: -5, currency: "USD" } } } }));
    const { getPrivateRecords } = await import("./private-store");
    await expect(getPrivateRecords()).rejects.toThrow(/w1\.purchase\.price/);
  });

  it("returns nothing in the static build, even when the file exists", async () => {
    await fs.mkdir(path.dirname(privateFile()), { recursive: true });
    await fs.writeFile(privateFile(), JSON.stringify({ w1: { purchase: paid } }));
    vi.stubEnv("NEXT_PUBLIC_STATIC", "true");
    const { getPrivateRecords } = await import("./private-store");
    expect(await getPrivateRecords()).toEqual({});
  });
});

describe("parsePurchaseFields", () => {
  const today = new Date("2026-10-10T12:00:00Z");

  it("requires a positive price and keeps optional fields only when given", () => {
    expect(parsePurchaseFields({ amount: "850", currency: "usd", date: "", source: " " }, today))
      .toEqual({ ok: true, purchase: { price: { amount: 850, currency: "USD" } } });
    const missing = parsePurchaseFields({ amount: "", currency: "USD" }, today);
    expect(missing.ok).toBe(false);
  });

  it("rejects impossible and future dates", () => {
    const bad = parsePurchaseFields({ amount: "1", currency: "USD", date: "2026-02-30" }, today);
    const future = parsePurchaseFields({ amount: "1", currency: "USD", date: "2026-10-11" }, today);
    expect(bad.ok || future.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.date).toMatch(/2026-03-14/);
    if (!future.ok) expect(future.errors.date).toMatch(/future/);
  });
});

describe("public watch data", () => {
  it("refuses a purchase in a watch patch rather than dropping it silently", () => {
    const result = normalizeWatchPatch({ purchase: paid });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/purchase is private/);
  });
});
