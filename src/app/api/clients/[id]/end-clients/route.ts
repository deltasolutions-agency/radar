import type { NextRequest } from "next/server";
import { json, withApi, requireSession } from "@/lib/api";
import { getEndClientSuggestions } from "@/lib/end-client";

type Params = { params: { id: string } };

// GET /api/clients/[id]/end-clients — clienti finali già usati (autocomplete).
export function GET(_req: NextRequest, { params }: Params) {
  return withApi(async () => {
    await requireSession();
    return json({ endClients: await getEndClientSuggestions(params.id) });
  });
}
