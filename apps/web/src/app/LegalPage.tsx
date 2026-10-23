import { getDb } from "@/db";
import { getTexts } from "@/lib/texts";
import type { TextKey } from "@/lib/texts";
import { Footer } from "./Footer";

export async function LegalPage({ title, textKey }: { title: string; textKey: TextKey }) {
  const t = await getTexts(await getDb(), [textKey]);
  return (
    <>
      <main className="page">
        <h1>{title}</h1>
        <p className="text">{t[textKey]}</p>
      </main>
      <Footer />
    </>
  );
}
