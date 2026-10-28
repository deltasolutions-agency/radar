import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { langFromParam } from "@/lib/i18n";

type Props = { searchParams: { lang?: string } };

export function generateMetadata({ searchParams }: Props): Metadata {
  return {
    title:
      langFromParam(searchParams.lang) === "en"
        ? "Terms and Conditions — Radar"
        : "Termini e Condizioni — Radar",
  };
}

function Clause({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1 font-semibold">
        {n}. {label}
      </h2>
      <p className="text-slate-700">{children}</p>
    </section>
  );
}

/** Testo italiano (versione che prevale). */
function TerminiIt() {
  return (
    <LegalShell title="Termini e Condizioni" englishHref="/termini?lang=en">
      <Clause n={1} label="Oggetto">
        Delta Solutions Agency, brand di proprietà di Andrea Trinca (P.IVA
        IT13983231005, PEC a.trinca@pec.it), gestisce tramite la piattaforma
        Radar l&apos;erogazione, il rinnovo e la fatturazione dei servizi
        digitali (domini, hosting, SSL, privacy, email) sottoscritti dal
        cliente.
      </Clause>

      <Clause n={2} label="Pagamenti">
        I pagamenti sono processati tramite Stripe. Per i servizi con rinnovo
        automatico concordato, il cliente autorizza l&apos;addebito ricorrente
        sul metodo di pagamento registrato, alla cadenza indicata nel riepilogo
        del servizio. Il cliente può revocare l&apos;autorizzazione in qualsiasi
        momento scrivendo a hello@deltasolutions.agency.
      </Clause>

      <Clause n={3} label="Fatturazione">
        A fronte di ogni pagamento confermato, la fattura viene emessa e
        recapitata entro 12 giorni lavorativi.
      </Clause>

      <Clause n={4} label="Recesso">
        Il cliente può esercitare il diritto di recesso dal servizio
        comunicandolo entro 30 giorni prima della scadenza del servizio in
        corso, scrivendo a hello@deltasolutions.agency.
      </Clause>

      <Clause n={5} label="Responsabilità">
        Delta Solutions Agency non è in alcun modo responsabile di disservizi
        non direttamente imputabili a Delta Solutions Agency (a titolo
        esemplificativo: malfunzionamenti di servizi terzi, provider esterni,
        cause di forza maggiore).
      </Clause>

      <Clause n={6} label="Foro competente e limitazione di responsabilità">
        Per qualsiasi controversia è competente in via esclusiva il Foro di
        Roma. In nessun caso Delta Solutions Agency potrà essere ritenuta
        responsabile per risarcimenti eccedenti la somma effettivamente
        corrisposta dal cliente per il servizio oggetto della controversia.
      </Clause>
    </LegalShell>
  );
}

/** Traduzione di cortesia, fedele al testo italiano. */
function TerminiEn() {
  return (
    <LegalShell title="Terms and Conditions" lang="en" italianHref="/termini">
      <Clause n={1} label="Subject matter">
        Delta Solutions Agency, a brand owned by Andrea Trinca (VAT number
        IT13983231005, PEC (certified email) a.trinca@pec.it), uses the Radar
        platform to manage the provision, renewal and invoicing of the digital
        services (domains, hosting, SSL, privacy, email) subscribed to by the
        client.
      </Clause>

      <Clause n={2} label="Payments">
        Payments are processed through Stripe. For services with an agreed
        automatic renewal, the client authorises recurring charges to the
        registered payment method, at the frequency indicated in the service
        summary. The client may revoke this authorisation at any time by
        writing to hello@deltasolutions.agency.
      </Clause>

      <Clause n={3} label="Invoicing">
        For every confirmed payment, the invoice is issued and delivered within
        12 working days.
      </Clause>

      <Clause n={4} label="Withdrawal">
        The client may exercise the right of withdrawal from the service by
        giving notice at least 30 days before the expiry of the current
        service, by writing to hello@deltasolutions.agency.
      </Clause>

      <Clause n={5} label="Liability">
        Delta Solutions Agency is in no way liable for service disruptions not
        directly attributable to Delta Solutions Agency (by way of example:
        malfunctions of third-party services, external providers, force
        majeure).
      </Clause>

      <Clause n={6} label="Jurisdiction and limitation of liability">
        The Court of Rome shall have exclusive jurisdiction over any dispute.
        Under no circumstances may Delta Solutions Agency be held liable for
        damages exceeding the amount actually paid by the client for the
        service that is the subject of the dispute.
      </Clause>
    </LegalShell>
  );
}

export default function TerminiPage({ searchParams }: Props) {
  return langFromParam(searchParams.lang) === "en" ? <TerminiEn /> : <TerminiIt />;
}
