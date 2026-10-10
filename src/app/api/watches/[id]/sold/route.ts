import { NextRequest, NextResponse } from "next/server";
import { parseSoldFields } from "@/lib/sale-entry";
import { markWatchSold, SaleConflictError } from "@/lib/sale-store";
import { SaleStateError } from "@/lib/store";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// POST { fields, revision } marks an owned watch sold: public price, date and
// channel plus a SoldComp in watches.json; fees, shipping and buyer in
// data/private.json.
export async function POST(req: NextRequest, { params }: Context) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Could not read the sale. Please try again." }, { status: 400 }); }
  if (typeof body?.revision !== "string") return NextResponse.json({ error: "Reopen the sale form before saving." }, { status: 400 });

  const parsed = parseSoldFields(body.fields);
  if (!parsed.ok) return NextResponse.json({ error: "Check the highlighted fields.", errors: parsed.errors }, { status: 400 });
  try {
    const { id } = await params;
    const watch = await markWatchSold(id, parsed.value, body.revision);
    if (!watch) return NextResponse.json({ error: "This watch no longer exists." }, { status: 404 });
    return NextResponse.json({ status: watch.status });
  } catch (error) {
    if (error instanceof SaleConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SaleStateError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: "Couldn't record the sale. Your entries are still here; try again." }, { status: 500 });
  }
}
