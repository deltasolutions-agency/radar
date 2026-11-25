import type { Metadata } from "next";
import { CloudLegalDoc } from "@/components/cloud-legal-doc";
import { CLOUD_TERMS, CLOUD_TERMS_INTRO } from "@/lib/cloud-legal";

export const metadata: Metadata = {
  title: "Condizioni generali di servizio — Delta Solutions Cloud",
};

export default function CloudCondizioniPage() {
  return (
    <CloudLegalDoc
      title="Condizioni generali di servizio"
      intro={CLOUD_TERMS_INTRO}
      sections={CLOUD_TERMS}
      role="Fornitore"
    />
  );
}
