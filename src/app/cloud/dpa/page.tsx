import type { Metadata } from "next";
import { CloudLegalDoc } from "@/components/cloud-legal-doc";
import { CLOUD_DPA, CLOUD_DPA_INTRO } from "@/lib/cloud-legal";

export const metadata: Metadata = {
  title: "Accordo sul trattamento dei dati (DPA) — Delta Solutions Cloud",
};

export default function CloudDpaPage() {
  return (
    <CloudLegalDoc
      title="Accordo sul trattamento dei dati (DPA)"
      intro={CLOUD_DPA_INTRO}
      sections={CLOUD_DPA}
      role="Responsabile del trattamento"
    />
  );
}
