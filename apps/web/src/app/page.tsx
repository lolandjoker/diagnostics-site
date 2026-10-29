import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { conversationForLead } from "@/lib/chat";
import { getLead, rememberedLeadId } from "@/lib/leads";
import { getTexts } from "@/lib/texts";
import { Brand } from "./Brand";
import { Footer } from "./Footer";
import { LeadForm } from "./LeadForm";
import { PriceTag } from "./PriceTag";
import { Track } from "./Track";

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
        <Brand variant="hero" />
        <h1>{t["home.title"]}</h1>
        {t["home.subtitle"] && <p className="lead text">{t["home.subtitle"]}</p>}
        <LeadForm button={t["home.button"]} price={<PriceTag db={db} />} />
        <Track step="home" />
      </main>
      <Footer />
    </>
  );
}
