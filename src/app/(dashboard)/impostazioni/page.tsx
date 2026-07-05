import {
  loadReminderThresholds,
  loadReminderTemplates,
  loadAutoChargeReminderHours,
} from "@/lib/reminder-settings";
import {
  REMINDER_CONFIGURABLE_TYPES,
  REMINDER_DEFAULTS,
  type ReminderConfigurableType,
} from "@/lib/email-templates";
import { ImpostazioniForm, type TemplateField } from "./impostazioni-form";

export const dynamic = "force-dynamic";

const TYPE_LABELS: Record<ReminderConfigurableType, string> = {
  PROMEMORIA_30: "Promemoria — soglia più lontana",
  PROMEMORIA_15: "Promemoria — soglia intermedia",
  PROMEMORIA_7: "Promemoria — soglia più vicina",
  SOLLECITO: "Sollecito (dopo la scadenza)",
  CESSAZIONE_MOROSITA: "Cessazione per morosità",
};

export default async function ImpostazioniPage() {
  const [thresholds, templates, autoChargeReminderHours] = await Promise.all([
    loadReminderThresholds(),
    loadReminderTemplates(),
    loadAutoChargeReminderHours(),
  ]);

  const templateFields: TemplateField[] = REMINDER_CONFIGURABLE_TYPES.map(
    (type) => {
      const def = REMINDER_DEFAULTS[type];
      const current = templates[type];
      return {
        type,
        label: TYPE_LABELS[type],
        defaultSubject: def.subject,
        defaultBody: def.body,
        subject: current?.subject ?? "",
        body: current?.body ?? "",
      };
    },
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Impostazioni</h1>
        <p className="mt-1 text-sm text-slate-500">
          Soglie dei promemoria e testi delle email di reminder.
        </p>
      </div>

      <ImpostazioniForm
        initial={{
          thresholdsLongDays: thresholds.thresholdsLongDays.join(", "),
          thresholdsShortDays: thresholds.thresholdsShortDays.join(", "),
          overdueDays: thresholds.overdueDays.join(", "),
          cessationDay: String(thresholds.cessationDay),
          autoChargeReminderHours: autoChargeReminderHours.join(", "),
          templates: templateFields,
        }}
      />
    </div>
  );
}
