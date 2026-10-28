import type { Metadata } from "next";
import { LegalShell } from "@/components/legal-shell";
import { langFromParam } from "@/lib/i18n";

type Props = { searchParams: { lang?: string } };

// Titolo identico in entrambe le lingue.
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

/** Testo italiano (versione che prevale). */
function PrivacyIt() {
  return (
    <LegalShell title="Privacy Policy" englishHref="/privacy?lang=en">
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

/** Traduzione di cortesia, fedele al testo italiano. */
function PrivacyEn() {
  return (
    <LegalShell title="Privacy Policy" lang="en" italianHref="/privacy">
      <Section label="Data controller">
        Andrea Trinca, owner of the Delta Solutions Agency brand — VAT number
        IT13983231005 — PEC (certified email) a.trinca@pec.it — email
        hello@deltasolutions.agency
      </Section>

      <Section label="Data collected">
        Personal and billing details (company name, VAT number/tax code,
        address), email, payment data (handled directly by Stripe — we do not
        store card numbers).
      </Section>

      <Section label="Purposes">
        Provision of the service, management of payments and renewals,
        communications relating to expiry dates and invoicing.
      </Section>

      <Section label="Sub-processors">
        Stripe Inc. (payments), Resend (email delivery).
      </Section>

      <Section label="Data retention">
        Data is retained solely for the purpose of managing the subscriptions
        for the services currently in place, for the entire duration of the
        contractual relationship.
      </Section>

      <Section label="Rights of the data subject">
        Access, rectification, erasure, portability — which may be requested by
        writing to hello@deltasolutions.agency.
      </Section>
    </LegalShell>
  );
}

export default function PrivacyPage({ searchParams }: Props) {
  return langFromParam(searchParams.lang) === "en" ? <PrivacyEn /> : <PrivacyIt />;
}
