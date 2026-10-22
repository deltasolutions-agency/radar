import { NextResponse, type NextRequest } from "next/server";
import { withApi, requireAdmin } from "@/lib/api";
import { buildPaymentWhere, findAllPayments, parsePaymentFilters } from "@/lib/payments-list";
import { paymentsToCsv } from "@/lib/payments-csv";
import { romeYmd } from "@/lib/rome-time";

export const dynamic = "force-dynamic";

// GET /api/payments/export?… — solo admin. CSV dei pagamenti con gli stessi
// filtri della sezione Pagamenti (tutte le pagine).
export function GET(req: NextRequest) {
  return withApi(async () => {
    await requireAdmin();
    const now = new Date();
    const filters = parsePaymentFilters(Object.fromEntries(req.nextUrl.searchParams));
    const rows = await findAllPayments(buildPaymentWhere(filters, now));
    return new NextResponse(paymentsToCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pagamenti-${romeYmd(now)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
