import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { json, withApi, requireAdmin } from "@/lib/api";

const schema = z
  .object({
    marginWarnPercent: z.number().int().min(1, "Tra 1 e 100").max(100, "Tra 1 e 100"),
    marginAlertPercent: z.number().int().min(0, "Tra 0 e 99").max(99, "Tra 0 e 99"),
  })
  .refine((d) => d.marginAlertPercent < d.marginWarnPercent, {
    message: "La soglia rossa deve essere più bassa di quella gialla",
    path: ["marginAlertPercent"],
  });

// PATCH /api/settings/dashboard — soglie di margine degli avvisi in dashboard.
export function PATCH(req: Request) {
  return withApi(async () => {
    const session = await requireAdmin();
    const data = schema.parse(await req.json());
    const settings = await prisma.dashboardSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data, updatedBy: session.email ?? null },
      update: { ...data, updatedBy: session.email ?? null },
    });
    return json({ settings });
  });
}
