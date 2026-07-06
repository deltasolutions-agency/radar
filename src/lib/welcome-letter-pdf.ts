import "server-only";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

/**
 * Genera in memoria (Node, pdf-lib — nessun LibreOffice/docx a runtime) la
 * lettera di benvenuto in PDF A4 su una sola pagina, da allegare alla mail di
 * benvenuto. Il logo viene scaricato ed incorporato; se il fetch fallisce si
 * ripiega su un wordmark testuale, senza mai far fallire la generazione.
 *
 * NB: pdf-lib non fa wrapping automatico → il testo lungo viene spezzato in
 * righe con `wrapText` usando le metriche del font.
 */

const LOGO_URL =
  "https://pub-70273716e01b45cf8c8d3e370de8c983.r2.dev/logo-orizzontale%20PMG.png";

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
const TITLE = "Un nuovo nome, un nuovo modo di gestire i tuoi servizi";

const INTRO =
  "Ti diamo il benvenuto! Deltaweb è ora Delta Solutions Agency: cambiano il nome e l'immagine, ma restano lo stesso team e la stessa cura dei tuoi servizi. Da oggi la gestione di scadenze, rinnovi e pagamenti passa attraverso Radar, la nostra piattaforma dedicata.";

const RADAR_LEAD = "Con Radar hai tutto in un unico posto:";
const RADAR_BULLETS = [
  "Promemoria automatici prima di ogni scadenza, così non rischi mai di dimenticare un rinnovo.",
  "Link di pagamento sicuri, per rinnovare i tuoi servizi in pochi clic.",
  "Ricevute dei tuoi rinnovi sempre disponibili e ordinate.",
  "Un riepilogo chiaro dei tuoi servizi e delle relative scadenze.",
];

const NO_ACTION =
  "Non devi fare nulla: continuiamo a occuparci noi dei tuoi servizi come sempre. Ti contatteremo solo quando ci sarà una scadenza da rinnovare, con tutte le istruzioni necessarie.";

const CONTACTS =
  "Per qualsiasi domanda o necessità puoi scriverci in qualsiasi momento a hello@deltasolutions.agency: siamo a tua disposizione.";

const THANKS = "Grazie per la fiducia che continui a riporre in noi.";

const SECURITY_LABEL = "SICUREZZA";
const SECURITY_TITLE = "Nessuna carta di credito richiesta ora";
const SECURITY_BODY =
  "Questa è solo una comunicazione di benvenuto: non ti stiamo chiedendo alcun pagamento né i dati della tua carta. Quando un servizio sarà in scadenza riceverai da noi un link di pagamento sicuro, sempre riconoscibile e riferito ai tuoi servizi.";
const SECURITY_ITALIC =
  "Se ricevi richieste di pagamento sospette o inattese, non procedere e scrivici subito a hello@deltasolutions.agency.";

const SIGN_NAME = "Andrea Trinca";
const SIGN_ORG = "Delta Solutions Agency";
const BRAND_LINE_1 =
  "Brand di proprietà di Andrea Trinca — P.IVA IT13983231005";
const BRAND_LINE_2 = "PEC a.trinca@pec.it — hello@deltasolutions.agency";

const MESI = [
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
];

function hex(h: string): RGB {
  const n = h.replace("#", "");
  return rgb(
    parseInt(n.slice(0, 2), 16) / 255,
    parseInt(n.slice(2, 4), 16) / 255,
    parseInt(n.slice(4, 6), 16) / 255,
  );
}

/** Data odierna in italiano esteso, es. "6 luglio 2026". */
function formatItalianDate(d: Date): string {
  return `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
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

/** Scarica i byte del logo con timeout; null se irraggiungibile. */
async function fetchLogoBytes(): Promise<Uint8Array | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(LOGO_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildWelcomeLetterPdf(clientName: string): Promise<Buffer> {
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
  const logoBytes = await fetchLogoBytes();
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
  for (const line of [BRAND_LINE_1, BRAND_LINE_2]) {
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
  const dateStr = `Roma, ${formatItalianDate(new Date())}`;
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
  for (const line of wrapText(TITLE, fontBold, titleSize, contentW)) {
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

  paragraph(`Gentile ${clientName},`, { gapAfter: 6 });
  paragraph(INTRO, { gapAfter: 8 });
  paragraph(RADAR_LEAD, { gapAfter: 4 });

  // Bullet list (indentata, con pallino).
  const bulletIndent = 14;
  for (const b of RADAR_BULLETS) {
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

  paragraph(NO_ACTION, { gapAfter: 8 });
  paragraph(CONTACTS, { gapAfter: 8 });
  paragraph(THANKS, { gapAfter: 14 });

  // ── Card disclaimer sicurezza ─────────────────────────────────────────────
  const cardPadX = 14;
  const cardPadY = 12;
  const cardInnerW = contentW - cardPadX * 2;
  const labelSize = 8;
  const secTitleSize = 11;

  // Pre-calcolo altezza della card per disegnare prima sfondo/bordi.
  const bodyLines = wrapText(SECURITY_BODY, font, bodySize, cardInnerW);
  const italicLines = wrapText(SECURITY_ITALIC, fontItalic, bodySize, cardInnerW);
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
  // Etichetta "SICUREZZA" (spaziata)
  page.drawText(SECURITY_LABEL.split("").join(" "), {
    x: marginX + cardPadX,
    y: cy - labelSize,
    size: labelSize,
    font,
    color: GREY,
  });
  cy -= labelSize + 6;
  // Titolo card
  page.drawText(SECURITY_TITLE, {
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
  page.drawText("Cordiali saluti,", { x: marginX, y: y - bodySize, size: bodySize, font, color: BODY });
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
