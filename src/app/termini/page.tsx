import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Termini e Condizioni — Radar",
};

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

export default function TerminiPage() {
  return (
    <LegalShell title="Termini e Condizioni">
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
