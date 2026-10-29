import Link from "next/link";
import { getDb } from "@/db";
import { botUsername, telegramConfig } from "@/lib/telegram";
import { getTexts } from "@/lib/texts";
import { BRAND, Emblem } from "./Brand";

export async function Footer() {
  const t = await getTexts(await getDb(), ["footer.text"]);
  // Ссылка на бота — его имя спрашиваем у Telegram: сменится бот — сменится и ссылка
  const cfg = telegramConfig();
  const bot = cfg ? await botUsername(cfg) : null;
  return (
    <footer className="footer">
      {t["footer.text"] && <p className="text">{t["footer.text"]}</p>}
      <p className="footer__brand">
        <Emblem className="footer__mark" />
        <span>
          © {new Date().getFullYear()} {BRAND}
        </span>
      </p>
      <nav>
        <Link href="/oferta">Оферта</Link>
        <Link href="/privacy">Политика обработки данных</Link>
        {bot && (
          <a href={`https://t.me/${bot}`} target="_blank" rel="noopener noreferrer">
            Telegram
          </a>
        )}
      </nav>
    </footer>
  );
}
