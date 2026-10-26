import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { getLead, rememberedLeadId } from "@/lib/leads";
import { getTexts } from "@/lib/texts";
import { Footer } from "./Footer";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

export default async function HomePage(props: PageProps<"/">) {
  const db = await getDb();
  // Уже заполнял форму в этом браузере — сразу в свой чат или разбор. ?new=1 — новый разбор
  const { new: fresh } = await props.searchParams;
  const rememberedId = fresh === "1" ? null : await rememberedLeadId();
  const remembered = rememberedId ? await getLead(db, rememberedId) : null;
  if (remembered) {
    redirect((await conversationForLead(db, remembered.id)) ? `/razbor/${remembered.id}/chat` : `/razbor/${remembered.id}`);
  }

  const t = await getTexts(db, ["home.title", "home.subtitle", "home.button"]);
  return (
    <>
      <main className="page page--narrow">
        <svg className="mark" viewBox="0 0 56 56" fill="none" aria-hidden="true">
          <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="28" cy="28" r="17" stroke="currentColor" strokeWidth="1" opacity="0.6" />
          <path
            d="M28 6v44M6 28h44M12.4 12.4l31.2 31.2M43.6 12.4L12.4 43.6"
            stroke="currentColor"
            strokeWidth="0.75"
            opacity="0.45"
          />
          <circle cx="28" cy="28" r="3" fill="currentColor" />
        </svg>
        <h1>{t["home.title"]}</h1>
        {t["home.subtitle"] && <p className="lead text">{t["home.subtitle"]}</p>}
        <LeadForm button={t["home.button"]} />
      </main>
      <Footer />
    </>
  );
}
