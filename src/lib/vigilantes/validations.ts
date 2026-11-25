import { z } from "zod";
import { normalizeSiteUrl } from "@/lib/vigilantes/protocol";

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim() || null)
    .nullable()
    .optional();

const siteUrl = z
  .string()
  .min(1, "Indica l'URL del sito")
  .transform((v, ctx) => {
    const n = normalizeSiteUrl(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL non valido (es. https://www.sito.it)" });
      return z.NEVER;
    }
    return n;
  });

export const siteCreateSchema = z.object({
  name: z.string().trim().min(1, "Indica un nome").max(200),
  url: siteUrl,
  clientId: optText(50),
  notes: optText(2000),
});

export const siteUpdateSchema = z.object({
  name: z.string().trim().min(1, "Indica un nome").max(200).optional(),
  url: siteUrl.optional(),
  clientId: optText(50),
  notes: optText(2000),
  enabled: z.boolean().optional(),
  deepScan: z.boolean().optional(),
});
