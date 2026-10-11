import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Watch } from "./types";

// store.ts resolves its data directory from process.cwd() once, at module load.
// So each test needs both a mocked cwd AND a module registry reset, otherwise
// the cached module keeps writing to the first test's temp directory.
let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

const baseWatch: Watch = {
  id: "w1",
  brand: "Test",
  model: "Model",
  status: "wishlist",
  price: { amount: 500, currency: "USD" },
  links: [],
  specs: {},
  tags: [],
  dateAdded: "2026-01-01T00:00:00Z",
};

async function seed(watches: Watch[]) {
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "watches.json"), JSON.stringify(watches, null, 2));
}

async function readStored(): Promise<Watch[]> {
  return JSON.parse(await fs.readFile(path.join(tempDir, "data", "watches.json"), "utf-8"));
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-store-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  vi.resetModules();
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("updateWatch price history", () => {
  it("records a snapshot when the price changes", async () => {
    const { updateWatch } = await import("./store");
    await seed([baseWatch]);

    await updateWatch("w1", { price: { amount: 450, currency: "USD" } });

    const [stored] = await readStored();
    const latest = stored.priceHistory?.[stored.priceHistory.length - 1];
    expect(latest?.price.amount).toBe(450);
    expect(latest?.source).toBe("manual");
    expect(stored.priceUpdatedAt).toBeTruthy();
  });

  it("seeds the outgoing price when a watch has no series yet", async () => {
    const { updateWatch } = await import("./store");
    await seed([{ ...baseWatch, priceUpdatedAt: "2026-03-01T00:00:00Z" }]);

    await updateWatch("w1", { price: { amount: 450, currency: "USD" } });

    const [stored] = await readStored();
    // The price it moved *from* is preserved, dated to when it was last known.
    expect(stored.priceHistory?.map((s) => s.price.amount)).toEqual([500, 450]);
    expect(stored.priceHistory?.[0].date).toBe("2026-03-01T00:00:00Z");
  });

  it("falls back to dateAdded when seeding a watch with no priceUpdatedAt", async () => {
    const { updateWatch } = await import("./store");
    await seed([baseWatch]);

    await updateWatch("w1", { price: { amount: 450, currency: "USD" } });

    const [stored] = await readStored();
    expect(stored.priceHistory?.[0].date).toBe("2026-01-01T00:00:00Z");
  });

  it("appends to an existing series", async () => {
    const { updateWatch } = await import("./store");
    await seed([
      {
        ...baseWatch,
        priceHistory: [{ price: { amount: 500, currency: "USD" }, date: "2026-01-01T00:00:00Z" }],
      },
    ]);

    await updateWatch("w1", { price: { amount: 450, currency: "USD" } });

    const [stored] = await readStored();
    expect(stored.priceHistory?.map((s) => s.price.amount)).toEqual([500, 450]);
  });

  it("does not record anything when the price is unchanged", async () => {
    const { updateWatch } = await import("./store");
    await seed([
      {
        ...baseWatch,
        priceHistory: [{ price: { amount: 500, currency: "USD" }, date: "2026-01-01T00:00:00Z" }],
      },
    ]);

    await updateWatch("w1", { price: { amount: 500, currency: "USD" }, notes: "edited" });

    const [stored] = await readStored();
    expect(stored.priceHistory).toHaveLength(1);
    expect(stored.notes).toBe("edited");
  });

  it("leaves history alone on an edit that does not touch price", async () => {
    const { updateWatch } = await import("./store");
    await seed([baseWatch]);

    await updateWatch("w1", { notes: "just a note" });

    const [stored] = await readStored();
    expect(stored.priceHistory).toBeUndefined();
  });

  it("defers to a caller that supplies its own history", async () => {
    const { updateWatch } = await import("./store");
    await seed([baseWatch]);

    const imported = [
      { price: { amount: 800, currency: "USD" }, date: "2025-01-01T00:00:00Z" },
      { price: { amount: 450, currency: "USD" }, date: "2025-06-01T00:00:00Z" },
    ];
    await updateWatch("w1", { price: { amount: 450, currency: "USD" }, priceHistory: imported });

    const [stored] = await readStored();
    expect(stored.priceHistory?.map((s) => s.price.amount)).toEqual([800, 450]);
  });
});

describe("addWatch price history", () => {
  it("seeds a snapshot for a watch created with a price", async () => {
    const { addWatch } = await import("./store");
    await seed([]);

    const created = await addWatch({
      brand: "New",
      model: "Watch",
      status: "wishlist",
      price: { amount: 1200, currency: "USD" },
      links: [],
      specs: {},
      tags: [],
    });

    expect(created.priceHistory).toHaveLength(1);
    expect(created.priceHistory?.[0].price.amount).toBe(1200);
  });

  it("creates no history for a watch added without a price", async () => {
    const { addWatch } = await import("./store");
    await seed([]);

    const created = await addWatch({
      brand: "New",
      model: "Watch",
      status: "wishlist",
      links: [],
      specs: {},
      tags: [],
    });

    expect(created.priceHistory).toBeUndefined();
  });
});

describe("recordDesignComparison", () => {
  it("updates both watches atomically inside the same appeal band", async () => {
    const { recordDesignComparison } = await import("./store");
    await seed([
      { ...baseWatch, id: "left", designUniqueness: 4 },
      { ...baseWatch, id: "right", designUniqueness: 4 },
    ]);

    const result = await recordDesignComparison("left", "right", "left");
    expect(result?.left.designPreferenceElo).toBe(1016);
    expect(result?.right.designPreferenceElo).toBe(984);

    const stored = await readStored();
    expect(stored.map((watch) => watch.designComparisonCount)).toEqual([1, 1]);
  });

  it("rejects comparisons across different anchored ratings", async () => {
    const { recordDesignComparison } = await import("./store");
    await seed([
      { ...baseWatch, id: "left", designUniqueness: 3 },
      { ...baseWatch, id: "right", designUniqueness: 4 },
    ]);

    expect(await recordDesignComparison("left", "right", "left")).toBeUndefined();
    expect(await readStored()).toEqual([
      { ...baseWatch, id: "left", designUniqueness: 3 },
      { ...baseWatch, id: "right", designUniqueness: 4 },
    ]);
  });
});

describe("tag normalization on save", () => {
  it("stores added and edited tags lowercase and de-duplicated", async () => {
    const { addWatch, updateWatch } = await import("./store");
    await seed([]);

    const added = await addWatch({ ...baseWatch, tags: ["GMT", " Diver ", "gmt"] });
    expect((await readStored())[0].tags).toEqual(["gmt", "diver"]);

    await updateWatch(added.id, { tags: ["Chronograph", "GMT"] });
    expect((await readStored())[0].tags).toEqual(["chronograph", "gmt"]);
  });

  it("leaves tags alone on an edit that doesn't send them", async () => {
    const { updateWatch } = await import("./store");
    await seed([{ ...baseWatch, tags: ["GMT"] }]);

    await updateWatch("w1", { notes: "checked" });
    expect((await readStored())[0].tags).toEqual(["GMT"]);
  });
});

describe("setFinalist", () => {
  it("pins up to the cap and refuses the next, under the write lock", async () => {
    const { setFinalist, FinalistError } = await import("./store");
    await seed(Array.from({ length: 6 }, (_, i) => ({ ...baseWatch, id: `w${i}` })));

    for (let i = 0; i < 5; i++) await setFinalist(`w${i}`, true);
    await expect(setFinalist("w5", true)).rejects.toBeInstanceOf(FinalistError);

    await setFinalist("w0", false);
    await setFinalist("w5", true);
    const stored = await readStored();
    expect(stored.filter((w) => w.finalist).map((w) => w.id)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
    // Unpinning removes the key rather than storing false.
    expect("finalist" in stored[0]).toBe(false);
  });

  it("unpins a finalist that is bought or passed on", async () => {
    const { updateWatch } = await import("./store");
    await seed([{ ...baseWatch, finalist: true }, { ...baseWatch, id: "w2", finalist: true }]);

    await updateWatch("w1", { status: "owned" });
    await updateWatch("w2", { wishlistTier: "pass" });
    expect((await readStored()).some((w) => w.finalist)).toBe(false);
  });

  it("keeps a finalist through an ordinary edit, which never sends the field", async () => {
    const { updateWatch } = await import("./store");
    await seed([{ ...baseWatch, finalist: true }]);

    await updateWatch("w1", { notes: "checked the bracelet" });
    expect((await readStored())[0].finalist).toBe(true);
  });
});

describe("edit form link round trip", () => {
  const stored = {
    url: "https://shop.example/w",
    retailer: "shop.example",
    price: { amount: 459, currency: "USD" },
    condition: "new" as const,
    observedAt: "2026-10-10T15:56:08.146Z",
    askHistory: [{ price: { amount: 459, currency: "USD" }, date: "2026-10-10T15:56:08.146Z", source: "scrape" as const }],
  };

  // What WatchForm's buildPayload sends for an untouched row.
  async function formLink(row: ReturnType<typeof import("./link-rows").toLinkRow>) {
    const { observedAtForSave } = await import("./link-rows");
    return {
      url: row.url,
      retailer: row.retailer,
      price: { amount: Number(row.priceAmount), currency: row.priceCurrency },
      condition: row.condition || undefined,
      observedAt: observedAtForSave(row),
    };
  }

  it("keeps a link's timestamp when only the notes change", async () => {
    const { updateWatch } = await import("./store");
    const { toLinkRow } = await import("./link-rows");
    await seed([{ ...baseWatch, links: [stored] }]);

    await updateWatch("w1", { notes: "I also like the orange version.", links: [await formLink(toLinkRow(stored))] });

    const [link] = (await readStored())[0].links;
    expect(link.observedAt).toBe("2026-10-10T15:56:08.146Z");
    expect(link.askHistory).toEqual(stored.askHistory);
  });

  it("still re-dates a changed ask whose date was left as it was", async () => {
    const { updateWatch } = await import("./store");
    const { toLinkRow } = await import("./link-rows");
    await seed([{ ...baseWatch, links: [stored] }]);

    const row = { ...toLinkRow(stored), priceAmount: "429" };
    await updateWatch("w1", { links: [await formLink(row)] });

    const [link] = (await readStored())[0].links;
    expect(link.price?.amount).toBe(429);
    expect(link.observedAt).not.toBe(stored.observedAt);
    expect(new Date(link.observedAt!).getTime()).toBeGreaterThan(new Date(stored.observedAt).getTime());
  });
});
