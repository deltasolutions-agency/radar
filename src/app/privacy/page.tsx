import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — Radar",
};

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mono-label mb-1">{label}</h2>
      <p>{children}</p>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy">
      <Section label="Titolare del trattamento">
        Andrea Trinca, titolare del brand Delta Solutions Agency — P.IVA
        IT13983231005 — PEC a.trinca@pec.it — email
        hello@deltasolutions.agency
      </Section>

      <Section label="Dati raccolti">
        Dati anagrafici e di fatturazione (ragione sociale, P.IVA/CF,
        indirizzo), email, dati di pagamento (gestiti direttamente da Stripe —
        non conserviamo numeri di carta).
      </Section>

      <Section label="Finalità">
        Erogazione del servizio, gestione pagamenti e rinnovi, comunicazioni
        relative a scadenze e fatturazione.
      </Section>

      <Section label="Sub-responsabili del trattamento">
        Stripe Inc. (pagamenti), Resend (invio email).
      </Section>

      <Section label="Conservazione dei dati">
        I dati sono conservati esclusivamente per la finalità di gestione degli
        abbonamenti dei servizi in essere, per tutta la durata del rapporto
        contrattuale.
      </Section>

      <Section label="Diritti dell'interessato">
        Accesso, rettifica, cancellazione, portabilità — richiedibili scrivendo
        a hello@deltasolutions.agency.
      </Section>
    </LegalShell>
  );
}
