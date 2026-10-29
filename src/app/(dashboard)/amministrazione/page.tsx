import { redirect } from "next/navigation";

// /amministrazione → prima tab (Incassi).
export default function AmministrazionePage() {
  redirect("/amministrazione/incassi");
}
