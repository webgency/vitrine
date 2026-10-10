import { NextRequest, NextResponse } from "next/server";
import { parseListingFields } from "@/lib/sale-entry";
import { SaleConflictError, saveSaleListing, withdrawSaleListing } from "@/lib/sale-store";
import { SaleStateError } from "@/lib/store";
import { DataValidationError } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// PUT { fields, revision } saves a draft or publishes (fields.state);
// PUT { withdraw: true, revision } removes the listing, draft and photos.
export async function PUT(req: NextRequest, { params }: Context) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Could not read the listing. Please try again." }, { status: 400 }); }
  if (typeof body?.revision !== "string") return NextResponse.json({ error: "Reopen the listing before changing it." }, { status: 400 });

  try {
    const { id } = await params;
    let view;
    if (body.withdraw === true) {
      view = await withdrawSaleListing(id, body.revision);
    } else {
      const parsed = parseListingFields(body.fields);
      if (!parsed.ok) return NextResponse.json({ error: "Check the highlighted fields.", errors: parsed.errors }, { status: 400 });
      view = await saveSaleListing(id, parsed.value, body.revision);
    }
    if (!view) return NextResponse.json({ error: "This watch no longer exists." }, { status: 404 });
    return NextResponse.json({ listing: view });
  } catch (error) {
    if (error instanceof SaleConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof SaleStateError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof DataValidationError) {
      // Name the actual rule (e.g. "needs at least one of your own photos"),
      // not just "invalid", so the form can say what to fix.
      return NextResponse.json({ error: "The listing didn't pass validation.", errors: { form: error.errors.join(" ") } }, { status: 400 });
    }
    console.error(error);
    return NextResponse.json({ error: "Couldn't save the listing. Your draft is still here; try again." }, { status: 500 });
  }
}
