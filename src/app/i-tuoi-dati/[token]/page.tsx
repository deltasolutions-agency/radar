import { prisma } from "@/lib/prisma";
import { clientDataFieldsFor } from "@/lib/client-data";
import { langOf, tr, type Lang } from "@/lib/i18n";
import { HtmlLang } from "@/components/html-lang";
import { DataEditForm } from "./data-edit-form";

export const dynamic = "force-dynamic";

const LOGO_URL =
  "/logo-delta-solutions.png";

function Shell({
  children,
  lang = "it",
}: {
  children: React.ReactNode;
  lang?: Lang;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <HtmlLang lang={lang} />
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

  const lang: Lang = langOf(client.locale);
  const fields = clientDataFieldsFor(client, lang);

  const clientName = client.ragioneSociale?.trim()
    ? client.ragioneSociale
    : client.name;

  return (
    <Shell lang={lang}>
      <h1 className="text-lg font-semibold tracking-tight text-ink">
        {tr(lang, {
          it: "I tuoi dati di fatturazione",
          en: "Your billing details",
        })}
      </h1>
      <p className="mt-1 text-sm text-slate-500">{clientName}</p>
      <p className="mt-3 text-sm text-slate-600">
        {tr(lang, {
          it: "Ecco i dati che usiamo per la tua fatturazione. Dai un'occhiata quando vuoi: se è tutto corretto non devi fare nulla.",
          en: "These are the details we use for your invoicing. Take a look whenever you like: if everything is correct, you don't need to do anything.",
        })}
      </p>

      <div className="mt-6">
        <DataEditForm
          clientId={client.id}
          token={params.token}
          unlocked={client.dataEditUnlocked}
          fields={fields}
          lang={lang}
        />
      </div>

      <p className="mt-6 border-t border-line-soft pt-4 text-xs leading-relaxed text-slate-400">
        {tr(lang, {
          it: "Confermando questi dati, dichiari che sono corretti. Delta Solutions Agency non si assume responsabilità per l'accuratezza delle informazioni fornite dal cliente.",
          en: "By confirming these details, you declare that they are correct. Delta Solutions Agency accepts no responsibility for the accuracy of the information provided by the client.",
        })}
      </p>
    </Shell>
  );
}
