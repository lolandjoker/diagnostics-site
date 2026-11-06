"use client";

/** Выбор цветовой темы панели сотрудников: палитра в шапке, тема меняется сразу и запоминается (cookie). */
import { useEffect, useRef, useState } from "react";
import { STAFF_THEMES, STAFF_THEME_COOKIE, type StaffTheme } from "@/lib/staff-theme";

export function ThemePicker({ current }: { current: StaffTheme }) {
  const [theme, setTheme] = useState<StaffTheme>(current);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  function pick(t: StaffTheme) {
    setTheme(t);
    setOpen(false);
    document.cookie = `${STAFF_THEME_COOKIE}=${t}; path=/; max-age=${400 * 24 * 3600}; samesite=lax`;
    document.querySelectorAll(".admin").forEach((el) => el.setAttribute("data-theme", t));
  }

  return (
    <div className="theme-picker" ref={box}>
      <button type="button" className="theme-picker__btn" aria-label="Цветовая тема" title="Цветовая тема" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" />
          <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
          <circle cx="10.5" cy="7.5" r="1.2" fill="currentColor" />
          <circle cx="15" cy="7.8" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="theme-picker__menu" role="menu">
          {(Object.keys(STAFF_THEMES) as StaffTheme[]).map((t) => (
            <button key={t} type="button" role="menuitemradio" aria-checked={theme === t} className={theme === t ? "is-current" : undefined} onClick={() => pick(t)}>
              <span className="theme-picker__swatch" style={{ background: `linear-gradient(135deg, ${STAFF_THEMES[t].swatch[0]} 50%, ${STAFF_THEMES[t].swatch[1]} 50%)` }} aria-hidden="true" />
              {STAFF_THEMES[t].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
