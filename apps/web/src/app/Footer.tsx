import Link from "next/link";
import { getDb } from "@/db";
import { getTexts } from "@/lib/texts";

export async function Footer() {
  const t = await getTexts(await getDb(), ["footer.text"]);
  return (
    <footer className="footer">
      {t["footer.text"] && <p className="text">{t["footer.text"]}</p>}
      <nav>
        <Link href="/oferta">Оферта</Link>
        <Link href="/privacy">Политика обработки данных</Link>
      </nav>
    </footer>
  );
}
