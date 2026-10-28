import "server-only";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { tr, type Lang, type Localized } from "@/lib/i18n";

/**
 * Genera in memoria (Node, pdf-lib — nessun LibreOffice/docx a runtime) la
 * lettera di benvenuto in PDF A4 su una sola pagina, da allegare alla mail di
 * benvenuto. Il logo è un file locale del progetto (public/) letto da disco; se
 * la lettura fallisce si ripiega su un wordmark testuale, senza mai far fallire
 * la generazione.
 *
 * NB: pdf-lib non fa wrapping automatico → il testo lungo viene spezzato in
 * righe con `wrapText` usando le metriche del font.
 */

const LOGO_PATH = join(process.cwd(), "public", "logo-delta-solutions.png");

// ── Colori brand (hex → rgb 0..1) ──────────────────────────────────────────
const BLUE = hex("#2B7FFF");
const VIOLET = hex("#8B5CF6");
const INK = hex("#12161F");
const GREY = hex("#666666");
const CARD_BORDER = hex("#E2DED6");
const CARD_BG = hex("#FAFAFA");
const CARD_TEXT = hex("#4A463F");
const BODY = hex("#1F2733");

// ── Testo della lettera (costanti revisionabili) ───────────────────────────
// Copy approvata riusata dalla mail di benvenuto (buildWelcomeEmail) + sezioni
// descritte nella specifica. Modificare qui per aggiornare la lettera.
// Ogni testo è affiancato IT/EN: la lingua è quella del cliente.
const TITLE: Localized = {
  it: "Un nuovo nome, un nuovo modo di gestire i tuoi servizi",
  en: "A new name, a new way to manage your services",
};

const INTRO: Localized = {
  it: "Ti diamo il benvenuto! Deltaweb è ora Delta Solutions Agency: cambiano il nome e l'immagine, ma restano lo stesso team e la stessa cura dei tuoi servizi. Da oggi la gestione di scadenze, rinnovi e pagamenti passa attraverso Radar, la nostra piattaforma dedicata.",
  en: "Welcome! Deltaweb is now Delta Solutions Agency: the name and look are changing, but the team and the care we take of your services remain the same. From today, expiry dates, renewals and payments are managed through Radar, our dedicated platform.",
};

const RADAR_LEAD: Localized = {
  it: "Con Radar hai tutto in un unico posto:",
  en: "With Radar you have everything in one place:",
};
const RADAR_BULLETS: Localized<string[]> = {
  it: [
    "Promemoria automatici prima di ogni scadenza, così non rischi mai di dimenticare un rinnovo.",
    "Link di pagamento sicuri, per rinnovare i tuoi servizi in pochi clic.",
    "Ricevute dei tuoi rinnovi sempre disponibili e ordinate.",
    "Un riepilogo chiaro dei tuoi servizi e delle relative scadenze.",
  ],
  en: [
    "Automatic reminders before every expiry date, so you never risk forgetting a renewal.",
    "Secure payment links, to renew your services in just a few clicks.",
    "Receipts for your renewals, always available and well organised.",
    "A clear overview of your services and their expiry dates.",
  ],
};

const NO_ACTION: Localized = {
  it: "Non devi fare nulla: continuiamo a occuparci noi dei tuoi servizi come sempre. Ti contatteremo solo quando ci sarà una scadenza da rinnovare, con tutte le istruzioni necessarie.",
  en: "You don't need to do anything: we will keep looking after your services as always. We will only contact you when a service is due for renewal, with all the instructions you need.",
};

const CONTACTS: Localized = {
  it: "Per qualsiasi domanda o necessità puoi scriverci in qualsiasi momento a hello@deltasolutions.agency: siamo a tua disposizione.",
  en: "If you have any questions or needs, you can write to us at any time at hello@deltasolutions.agency: we are here to help.",
};

const THANKS: Localized = {
  it: "Grazie per la fiducia che continui a riporre in noi.",
  en: "Thank you for the trust you continue to place in us.",
};

const SECURITY_LABEL: Localized = { it: "SICUREZZA", en: "SECURITY" };
const SECURITY_TITLE: Localized = {
  it: "Nessuna carta di credito richiesta ora",
  en: "No credit card required now",
};
const SECURITY_BODY: Localized = {
  it: "Questa è solo una comunicazione di benvenuto: non ti stiamo chiedendo alcun pagamento né i dati della tua carta. Quando un servizio sarà in scadenza riceverai da noi un link di pagamento sicuro, sempre riconoscibile e riferito ai tuoi servizi.",
  en: "This is just a welcome message: we are not asking you for any payment or for your card details. When a service is about to expire, you will receive a secure payment link from us, always recognisable and referring to your services.",
};
const SECURITY_ITALIC: Localized = {
  it: "Se ricevi richieste di pagamento sospette o inattese, non procedere e scrivici subito a hello@deltasolutions.agency.",
  en: "If you receive suspicious or unexpected payment requests, do not proceed and write to us immediately at hello@deltasolutions.agency.",
};

const GREETING: Localized<(name: string) => string> = {
  it: (name) => `Gentile ${name},`,
  en: (name) => `Dear ${name},`,
};
const CLOSING: Localized = { it: "Cordiali saluti,", en: "Kind regards," };

const SIGN_NAME = "Andrea Trinca";
const SIGN_ORG = "Delta Solutions Agency";
const BRAND_LINE_1: Localized = {
  it: "Brand di proprietà di Andrea Trinca — P.IVA IT13983231005",
  en: "Brand owned by Andrea Trinca — VAT number IT13983231005",
};
const BRAND_LINE_2: Localized = {
  it: "PEC a.trinca@pec.it — hello@deltasolutions.agency",
  en: "PEC (certified email) a.trinca@pec.it — hello@deltasolutions.agency",
};

const MONTHS: Localized<string[]> = {
  it: [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre",
  ],
  en: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
};

/** Luogo e data: "Roma, 6 luglio 2026" / "Rome, 6 July 2026". */
function formatPlaceDate(d: Date, lang: Lang): string {
  const city = tr(lang, { it: "Roma", en: "Rome" });
  return `${city}, ${d.getDate()} ${tr(lang, MONTHS)[d.getMonth()]} ${d.getFullYear()}`;
}

function hex(h: string): RGB {
  const n = h.replace("#", "");
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  );
}

/** Spezza `text` in righe che non superano `maxWidth` con quel font/size. */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Legge i byte del logo dal disco (file locale del progetto); null se assente. */
async function readLogoBytes(): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(LOGO_PATH);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function buildWelcomeLetterPdf(
  clientName: string,
  lang: Lang = "it",
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const { width: pageW, height: pageH } = page.getSize();

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const marginX = 55;
  const contentW = pageW - marginX * 2;
  let y = pageH - 45;

  // ── Header: logo (o wordmark di fallback) ────────────────────────────────
  const logoBytes = await readLogoBytes();
  const logoH = 40;
  if (logoBytes) {
    try {
      const png = await doc.embedPng(logoBytes);
      const scale = logoH / png.height;
      const logoW = png.width * scale;
      page.drawImage(png, { x: marginX, y: y - logoH, width: logoW, height: logoH });
    } catch {
      drawWordmark(page, fontBold, marginX, y - logoH + 8);
    }
  } else {
    drawWordmark(page, fontBold, marginX, y - logoH + 8);
  }
  y -= logoH + 10;

  // ── Barra bicolore a piena pagina ────────────────────────────────────────
  const barH = 4;
  page.drawRectangle({ x: 0, y: y - barH, width: pageW / 2, height: barH, color: BLUE });
  page.drawRectangle({
    x: pageW / 2,
    y: y - barH,
    width: pageW / 2,
    height: barH,
    color: VIOLET,
  });
  y -= barH + 12;

  // ── Riga brand/ownership, allineata a destra ─────────────────────────────
  const brandSize = 8;
  for (const line of [tr(lang, BRAND_LINE_1), tr(lang, BRAND_LINE_2)]) {
    const w = font.widthOfTextAtSize(line, brandSize);
    page.drawText(line, {
      x: pageW - marginX - w,
      y: y - brandSize,
      size: brandSize,
      font,
      color: GREY,
    });
    y -= brandSize + 3;
  }
  y -= 14;

  // ── Data (Roma, ...) allineata a destra ──────────────────────────────────
  const dateStr = formatPlaceDate(new Date(), lang);
  const dateSize = 10;
  const dateW = font.widthOfTextAtSize(dateStr, dateSize);
  page.drawText(dateStr, {
    x: pageW - marginX - dateW,
    y: y - dateSize,
    size: dateSize,
    font,
    color: GREY,
  });
  y -= dateSize + 18;

  // ── Titolo ───────────────────────────────────────────────────────────────
  const titleSize = 17;
  for (const line of wrapText(tr(lang, TITLE), fontBold, titleSize, contentW)) {
    page.drawText(line, { x: marginX, y: y - titleSize, size: titleSize, font: fontBold, color: INK });
    y -= titleSize + 4;
  }
  y -= 14;

  // ── Corpo lettera ─────────────────────────────────────────────────────────
  const bodySize = 10;
  const lead = 13.5;

  const paragraph = (
    text: string,
    opt: { font?: PDFFont; color?: RGB; gapAfter?: number } = {},
  ) => {
    const f = opt.font ?? font;
    const color = opt.color ?? BODY;
    for (const line of wrapText(text, f, bodySize, contentW)) {
      page.drawText(line, { x: marginX, y: y - bodySize, size: bodySize, font: f, color });
      y -= lead;
    }
    y -= opt.gapAfter ?? 8;
  };

  paragraph(tr(lang, GREETING)(clientName), { gapAfter: 6 });
  paragraph(tr(lang, INTRO), { gapAfter: 8 });
  paragraph(tr(lang, RADAR_LEAD), { gapAfter: 4 });

  // Bullet list (indentata, con pallino).
  const bulletIndent = 14;
  for (const b of tr(lang, RADAR_BULLETS)) {
    page.drawText("•", { x: marginX, y: y - bodySize, size: bodySize, font, color: BLUE });
    const lines = wrapText(b, font, bodySize, contentW - bulletIndent);
    for (const line of lines) {
      page.drawText(line, {
        x: marginX + bulletIndent,
        y: y - bodySize,
        size: bodySize,
        font,
        color: BODY,
      });
      y -= lead;
    }
    y -= 2;
  }
  y -= 8;

  paragraph(tr(lang, NO_ACTION), { gapAfter: 8 });
  paragraph(tr(lang, CONTACTS), { gapAfter: 8 });
  paragraph(tr(lang, THANKS), { gapAfter: 14 });

  // ── Card disclaimer sicurezza ─────────────────────────────────────────────
  const cardPadX = 14;
  const cardPadY = 12;
  const cardInnerW = contentW - cardPadX * 2;
  const labelSize = 8;
  const secTitleSize = 11;

  // Pre-calcolo altezza della card per disegnare prima sfondo/bordi.
  const bodyLines = wrapText(tr(lang, SECURITY_BODY), font, bodySize, cardInnerW);
  const italicLines = wrapText(tr(lang, SECURITY_ITALIC), fontItalic, bodySize, cardInnerW);
  const cardH =
    cardPadY * 2 +
    (labelSize + 6) +
    (secTitleSize + 6) +
    bodyLines.length * lead +
    6 +
    italicLines.length * lead;

  const cardTop = y;
  const cardBottom = cardTop - cardH;
  // Sfondo
  page.drawRectangle({
    x: marginX,
    y: cardBottom,
    width: contentW,
    height: cardH,
    color: CARD_BG,
    borderColor: CARD_BORDER,
    borderWidth: 1,
  });
  // Bordo sinistro spesso blu
  page.drawRectangle({ x: marginX, y: cardBottom, width: 4, height: cardH, color: BLUE });

  let cy = cardTop - cardPadY;
  // Etichetta "SICUREZZA"/"SECURITY" (spaziata)
  page.drawText(tr(lang, SECURITY_LABEL).split("").join(" "), {
    x: marginX + cardPadX,
    y: cy - labelSize,
    size: labelSize,
    font,
    color: GREY,
  });
  cy -= labelSize + 6;
  // Titolo card
  page.drawText(tr(lang, SECURITY_TITLE), {
    x: marginX + cardPadX,
    y: cy - secTitleSize,
    size: secTitleSize,
    font: fontBold,
    color: INK,
  });
  cy -= secTitleSize + 6;
  // Corpo card
  for (const line of bodyLines) {
    page.drawText(line, { x: marginX + cardPadX, y: cy - bodySize, size: bodySize, font, color: CARD_TEXT });
    cy -= lead;
  }
  cy -= 6;
  // Riga in corsivo
  for (const line of italicLines) {
    page.drawText(line, {
      x: marginX + cardPadX,
      y: cy - bodySize,
      size: bodySize,
      font: fontItalic,
      color: CARD_TEXT,
    });
    cy -= lead;
  }

  y = cardBottom - 22;

  // ── Chiusura / firma ──────────────────────────────────────────────────────
  page.drawText(tr(lang, CLOSING), { x: marginX, y: y - bodySize, size: bodySize, font, color: BODY });
  y -= lead + 4;
  page.drawText(SIGN_NAME, { x: marginX, y: y - 11, size: 11, font: fontBold, color: INK });
  y -= 15;
  page.drawText(SIGN_ORG, { x: marginX, y: y - 9, size: 9, font, color: GREY });

  // Guardia (non bloccante): segnala se il contenuto sfora il margine inferiore.
  if (y - 9 < 24) {
    console.warn(
      `[welcome-letter-pdf] contenuto vicino/oltre il margine inferiore (y=${(y - 9).toFixed(0)})`,
    );
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function drawWordmark(page: PDFPage, fontBold: PDFFont, x: number, y: number) {
  page.drawText("Delta Solutions", { x, y, size: 20, font: fontBold, color: BLUE });
}
