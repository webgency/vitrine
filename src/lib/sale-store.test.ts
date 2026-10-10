import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListingContent, Watch } from "./types";

// Same isolation as store.test.ts: every store resolves data/ and public/
// from process.cwd(), so each test mocks cwd and re-imports the modules.
let tempDir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

// A 1×1 JPEG is enough to exercise publishing; the browser downscales real ones.
const PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
// Changes a byte in the middle; a change in the base64 padding would decode
// to the same bytes and the same content hash.
const OTHER_PHOTO = PHOTO.replace("SABIAAD", "SABJAAD");

const owned: Watch = {
  id: "w1",
  brand: "Tissot",
  model: "Gentleman",
  status: "owned",
  price: { amount: 850, currency: "USD" },
  links: [],
  specs: { caseDiameterMm: 40 },
  tags: [],
  dateAdded: "2026-01-01T00:00:00Z",
};

const content = (photos: string[] = [PHOTO]): ListingContent => ({
  askingPrice: { amount: 700, currency: "USD" },
  grade: "excellent",
  included: ["Box"],
  photos,
});

const read = async (file: string) => JSON.parse(await fs.readFile(path.join(tempDir, file), "utf-8"));
const exists = (file: string) => fs.access(path.join(tempDir, file)).then(() => true, () => false);

async function seed(watches: Watch[]) {
  await fs.mkdir(path.join(tempDir, "data"), { recursive: true });
  await fs.writeFile(path.join(tempDir, "data", "watches.json"), JSON.stringify(watches, null, 2));
}

async function modules() {
  const sale = await import("./sale-store");
  const store = await import("./store");
  const privateStore = await import("./private-store");
  const revision = async () => sale.saleRevision((await store.getWatch("w1"))!, await privateStore.getPrivateRecord("w1"));
  return { ...sale, ...store, ...privateStore, revision };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-sale-test-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  vi.resetModules();
  await seed([owned]);
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("sale listings", () => {
  it("keeps a draft in private.json only: watches.json and public/ are untouched", async () => {
    const m = await modules();
    const before = await fs.readFile(path.join(tempDir, "data", "watches.json"), "utf-8");
    await m.saveSaleListing("w1", { state: "draft", content: content(), minimumPrice: { amount: 600, currency: "USD" } }, await m.revision());

    expect(await fs.readFile(path.join(tempDir, "data", "watches.json"), "utf-8")).toBe(before);
    expect(await exists("public/listings")).toBe(false);
    const record = (await read("data/private.json")).w1;
    expect(record.listingDraft.photos).toEqual([PHOTO]);
    expect(record.minimumPrice).toEqual({ amount: 600, currency: "USD" });
  });

  it("publishing writes the photos to public/listings and moves the draft out of private.json", async () => {
    const m = await modules();
    await m.saveSaleListing("w1", { state: "draft", content: content(), minimumPrice: { amount: 600, currency: "USD" } }, await m.revision());
    const view = await m.saveSaleListing("w1", { state: "live", content: content(), minimumPrice: { amount: 600, currency: "USD" } }, await m.revision());

    const watch = (await read("data/watches.json"))[0];
    expect(watch.listing.state).toBe("live");
    expect(watch.listing.photos).toHaveLength(1);
    expect(watch.listing.photos[0]).toMatch(/^listings\/w1\/[a-f0-9]{16}\.jpg$/);
    expect(await exists(`public/${watch.listing.photos[0]}`)).toBe(true);
    // The minimum stays private while the listing is live.
    expect(JSON.stringify(watch)).not.toContain("600");
    expect((await read("data/private.json")).w1).toEqual({ minimumPrice: { amount: 600, currency: "USD" } });
    expect(view?.state).toBe("live");
  });

  it("replacing a photo deletes the old file; moving back to draft removes the public listing and files", async () => {
    const m = await modules();
    await m.saveSaleListing("w1", { state: "live", content: content() }, await m.revision());
    const first = (await read("data/watches.json"))[0].listing.photos[0];
    await m.saveSaleListing("w1", { state: "live", content: content([OTHER_PHOTO]) }, await m.revision());
    expect(await exists(`public/${first}`)).toBe(false);

    const published = (await read("data/watches.json"))[0].listing.photos;
    await m.saveSaleListing("w1", { state: "draft", content: content(published) }, await m.revision());
    expect((await read("data/watches.json"))[0].listing).toBeUndefined();
    expect(await exists("public/listings/w1")).toBe(false);
    expect((await read("data/private.json")).w1.listingDraft.photos[0]).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("refuses to publish without a photo, and leaves no files behind", async () => {
    const m = await modules();
    const refused = await m.saveSaleListing("w1", { state: "live", content: content([]) }, await m.revision()).catch((error) => error);
    expect(refused.errors.join(" ")).toMatch(/at least one of your own photos/);
    expect((await read("data/watches.json"))[0].listing).toBeUndefined();
    expect(await exists("public/listings/w1")).toBe(false);
  });

  it("refuses a stale revision", async () => {
    const m = await modules();
    const stale = await m.revision();
    await m.saveSaleListing("w1", { state: "draft", content: content() }, stale);
    await expect(m.saveSaleListing("w1", { state: "live", content: content() }, stale)).rejects.toBeInstanceOf(m.SaleConflictError);
  });

  it("withdraw removes the listing, draft, minimum and photos", async () => {
    const m = await modules();
    await m.saveSaleListing("w1", { state: "live", content: content(), minimumPrice: { amount: 600, currency: "USD" } }, await m.revision());
    await m.withdrawSaleListing("w1", await m.revision());
    expect((await read("data/watches.json"))[0].listing).toBeUndefined();
    expect(await exists("public/listings/w1")).toBe(false);
    expect(await read("data/private.json")).toEqual({});
  });
});

describe("mark sold", () => {
  it("closes the sale: sold status, public price and comp, private costs, no photos, no alert", async () => {
    const m = await modules();
    await m.savePurchase("w1", { price: { amount: 850, currency: "USD" } }, JSON.stringify([null, "", "", ""]));
    await m.saveSaleListing("w1", { state: "live", content: content(), listingFees: [{ label: "PayPal" }] }, await m.revision());
    await m.markWatchSold("w1", {
      price: { amount: 680, currency: "USD" },
      date: "2026-10-09",
      channel: "r/Watchexchange",
      countAs: "pre-owned",
      close: { fees: [{ label: "PayPal", amount: { amount: 24, currency: "USD" } }], shipping: { amount: 15, currency: "USD" }, buyer: "u/someone" },
    }, await m.revision());

    const watch = (await read("data/watches.json"))[0];
    expect(watch.status).toBe("sold");
    expect(watch.listing).toBeUndefined();
    expect(watch.sale).toEqual({ price: { amount: 680, currency: "USD" }, date: "2026-10-09", channel: "r/Watchexchange" });
    expect(watch.soldComps).toEqual([{ price: { amount: 680, currency: "USD" }, condition: "pre-owned", soldAt: "2026-10-09", source: "Own sale — r/Watchexchange" }]);
    expect(JSON.stringify(watch)).not.toContain("u/someone");
    expect(await exists("public/listings/w1")).toBe(false);

    const record = (await read("data/private.json")).w1;
    expect(record.purchase.price.amount).toBe(850);
    expect(record.saleClose.buyer).toBe("u/someone");
    expect(record.listingFees).toBeUndefined();

    // Status change and a new comp are not market events.
    const alerts = await read("data/alerts.json").catch(() => ({ events: [] }));
    expect(alerts.events).toEqual([]);
  });

  it("refuses a watch that isn't owned", async () => {
    await seed([{ ...owned, status: "wishlist" }]);
    const m = await modules();
    await expect(m.markWatchSold("w1", { price: { amount: 1, currency: "USD" }, date: "2026-10-09", channel: "x", countAs: "pre-owned", close: { fees: [] } }, await m.revision()))
      .rejects.toBeInstanceOf(m.SaleStateError);
  });
});
