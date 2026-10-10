import { promises as fs } from "fs";
import path from "path";
import { sellerErrors } from "./seller-shape.mjs";

/** How buyers reach you, from data/seller.json (public, committed). */
export interface SellerContact {
  name?: string;
  email?: string;
  /** e.g. a PayPal.me link. A link only: no checkout is built in. */
  paymentUrl?: string;
  /** Button text for the payment link, e.g. "Pay with PayPal". */
  paymentLabel?: string;
  /** Payment method, shipping region, returns. */
  terms?: string;
}

/** Undefined when the file doesn't exist yet: the For-sale page then shows
 * listings without a contact block rather than failing. */
export async function getSeller(): Promise<SellerContact | undefined> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "seller.json"), "utf-8"));
    const errors = sellerErrors(data);
    if (errors.length) throw new Error(`data/seller.json is invalid:\n- ${errors.join("\n- ")}`);
    return data as SellerContact;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
