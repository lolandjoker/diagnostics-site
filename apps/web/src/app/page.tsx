import { getDb } from "@/db";
import { getTexts } from "@/lib/texts";
import { Footer } from "./Footer";
import { LeadForm } from "./LeadForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const t = await getTexts(await getDb(), ["home.title", "home.subtitle", "home.button", "home.consent"]);
  const maxDate = new Date().toISOString().slice(0, 10);
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
        <LeadForm button={t["home.button"]} consent={t["home.consent"]} maxDate={maxDate} />
      </main>
      <Footer />
    </>
  );
}
