import { NextRequest, NextResponse } from "next/server";
import { parsePurchaseFields, type PrivatePurchase } from "@/lib/purchase-entry";
import { PurchaseConflictError, savePurchase } from "@/lib/private-store";
import { getWatch } from "@/lib/store";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// PUT { fields: { amount, currency, date, source }, revision } sets what you paid;
// PUT { clear: true, revision } removes it. Writes data/private.json only.
export async function PUT(req: NextRequest, { params }: Context) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Could not read the purchase. Please try again." }, { status: 400 }); }
  if (typeof body?.revision !== "string") return NextResponse.json({ error: "Reopen the purchase before changing it." }, { status: 400 });

  let purchase: PrivatePurchase | undefined;
  if (body.clear !== true) {
    const parsed = parsePurchaseFields(body.fields);
    if (!parsed.ok) return NextResponse.json({ error: "Check the highlighted fields.", errors: parsed.errors }, { status: 400 });
    purchase = parsed.purchase;
  }

  try {
    const { id } = await params;
    const watch = await getWatch(id);
    if (!watch) return NextResponse.json({ error: "This watch no longer exists." }, { status: 404 });
    // A wishlist watch hasn't been bought; a price there would be a target.
    if (watch.status === "wishlist") return NextResponse.json({ error: "Only owned or sold watches have a purchase." }, { status: 400 });
    const saved = await savePurchase(id, purchase, body.revision);
    return NextResponse.json({ purchase: saved ?? null });
  } catch (error) {
    if (error instanceof PurchaseConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Couldn't save the purchase. Your draft is still here; try again." }, { status: 500 });
  }
}
