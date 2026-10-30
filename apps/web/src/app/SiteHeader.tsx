"use client";

/**
 * Шапка с названием на страницах клиента. Нет её на главной (там название крупно над формой),
 * в чате (место — переписке) и в панелях админа и экспертов.
 */
import { usePathname } from "next/navigation";
import { Brand } from "./Brand";

const HIDDEN = [/^\/$/, /^\/admin/, /^\/expert/, /^\/operator/, /^\/razbor\/[^/]+\/chat$/];

export function SiteHeader() {
  const pathname = usePathname();
  if (HIDDEN.some((re) => re.test(pathname))) return null;
  return (
    <header className="site-header">
      <Brand variant="bar" />
    </header>
  );
}
