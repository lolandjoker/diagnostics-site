import Link from "next/link";
import { Brand } from "./Brand";

/**
 * «Не найдено» в оформлении сайта, вместо стандартной английской страницы 404. Без подвала: страница
 * собирается заранее, без базы, а тексты подвала — из базы.
 */
export default function NotFound() {
  return (
    <main className="page page--narrow not-found">
      <Brand variant="hero" />
      <h1>Страница не найдена</h1>
      <p className="lead">Возможно, ссылка устарела или в адресе опечатка.</p>
      <Link className="button" href="/">
        На главную
      </Link>
    </main>
  );
}
