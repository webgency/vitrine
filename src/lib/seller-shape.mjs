// Seller contact for the public For-sale page: data/seller.json.
//
// Public on purpose — buyers need a way to reach you — and kept to what a
// listing page needs. Payment is a link (e.g. a PayPal.me URL), never an
// integration. Shared by the app and scripts/validate-data.mjs, hence .mjs.

const FIELDS = ["name", "email", "paymentUrl", "paymentLabel", "terms"];

/** @returns {string[]} */
export function sellerErrors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["data/seller.json must contain an object"];
  const errors = [];
  for (const key of Object.keys(value)) {
    if (!FIELDS.includes(key)) errors.push(`seller.${key} is not a known field (${FIELDS.join(", ")})`);
  }
  for (const key of FIELDS) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim())) errors.push(`seller.${key} must be non-empty text`);
  }
  if (typeof value.email === "string" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) errors.push("seller.email must be an email address");
  if (typeof value.paymentUrl === "string" && !/^https:\/\//.test(value.paymentUrl)) errors.push("seller.paymentUrl must be an https link");
  if (value.terms !== undefined && typeof value.terms === "string" && value.terms.length > 1000) errors.push("seller.terms must be under 1000 characters");
  if (!value.email && !value.paymentUrl) errors.push("seller needs at least an email so buyers can reach you");
  return errors;
}
