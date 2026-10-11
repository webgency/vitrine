import { NextRequest, NextResponse } from "next/server";
import { FinalistError, setFinalist } from "@/lib/store";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

// PUT { finalist: true } pins a finalist; { finalist: false } unpins it.
// The generic edit route never accepts the field, so the cap lives here alone.
export async function PUT(req: NextRequest, { params }: Context) {
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Could not read the request. Please try again." }, { status: 400 }); }
  if (typeof body?.finalist !== "boolean") return NextResponse.json({ error: "finalist must be true or false." }, { status: 400 });

  try {
    const { id } = await params;
    const watch = await setFinalist(id, body.finalist);
    if (!watch) return NextResponse.json({ error: "This watch no longer exists." }, { status: 404 });
    return NextResponse.json({ finalist: watch.finalist ?? false });
  } catch (error) {
    if (error instanceof FinalistError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error(error);
    return NextResponse.json({ error: "Couldn't save. Please try again." }, { status: 500 });
  }
}
