import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Radar — Delta Solutions",
  description:
    "Piattaforma interna per la gestione di abbonamenti, scadenze e pagamenti dei clienti.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
