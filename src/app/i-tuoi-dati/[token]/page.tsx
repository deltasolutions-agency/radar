import { prisma } from "@/lib/prisma";
import { clientDataFieldsFor } from "@/lib/client-data";
import { DataEditForm } from "./data-edit-form";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-6 flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={LOGO_URL} alt="Delta Solutions" className="h-7 w-auto" />
        <span className="mono-label">Radar</span>
      </div>
      <div className="card p-8">{children}</div>
    </main>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </Shell>
  );
}

export default async function ITuoiDatiPage({
  params,
}: {
  params: { token: string };
}) {
  const client = await prisma.client.findUnique({
    where: { dataEditToken: params.token },
  });

  if (!client) {
    return (
      <Message
        title="Link non valido"
        body="Questo link non è valido o non è più disponibile. Se hai bisogno di aggiornare i tuoi dati scrivici a hello@deltasolutions.agency."
      />
    );
  }

  const fields = clientDataFieldsFor(client);

  const clientName = client.ragioneSociale?.trim()
    ? client.ragioneSociale
    : client.name;

  return (
    <Shell>
      <h1 className="text-lg font-semibold tracking-tight text-ink">
        I tuoi dati di fatturazione
      </h1>
      <p className="mt-1 text-sm text-slate-500">{clientName}</p>
      <p className="mt-3 text-sm text-slate-600">
        Ecco i dati che usiamo per la tua fatturazione. Dai un&apos;occhiata
        quando vuoi: se è tutto corretto non devi fare nulla.
      </p>

      <div className="mt-6">
        <DataEditForm
          clientId={client.id}
          token={params.token}
          unlocked={client.dataEditUnlocked}
          fields={fields}
        />
      </div>

      <p className="mt-6 border-t border-line-soft pt-4 text-xs leading-relaxed text-slate-400">
        Confermando questi dati, dichiari che sono corretti. Delta Solutions
        Agency non si assume responsabilità per l&apos;accuratezza delle
        informazioni fornite dal cliente.
      </p>
    </Shell>
  );
}
