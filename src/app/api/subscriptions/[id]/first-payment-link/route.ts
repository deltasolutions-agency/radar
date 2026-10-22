import type { NextRequest } from "next/server";
import { json, error, withApi, requireSession } from "@/lib/api";
import { sendFirstPaymentLink } from "@/lib/activation";

type Params = { params: { id: string } };

// POST /api/subscriptions/[id]/first-payment-link — "Reinvia link primo
// pagamento": riusa il link se ancora valido (scaduto → rigenerato da /pay),
// altrimenti ne crea uno nuovo con gli importi attuali; nuova email (loggata).
export function POST(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    const result = await sendFirstPaymentLink(params.id, { trigger: "MANUAL" });
    if (!result.emailSent) return error(result.error ?? "Invio non riuscito", 400, result);
    return json(result);
  });
}
