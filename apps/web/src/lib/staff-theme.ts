/**
 * Цветовые темы панели сотрудников (админ, операторы, эксперты). Выбор — в cookie STAFF_THEME_COOKIE: панель
 * сразу рисуется в нужной теме, без мигания. Цвета — переменные в globals.css (`.admin[data-theme=…]`).
 */
export const STAFF_THEMES = {
  light: { label: "Светлая", swatch: ["#f6f4f9", "#8a6a1f"] },
  dark: { label: "Тёмная", swatch: ["#15111f", "#d9b66f"] },
  sand: { label: "Песочная", swatch: ["#f5ecdd", "#9a5b14"] },
  sea: { label: "Морская", swatch: ["#eaf2f7", "#1f6f8b"] },
} as const;

export type StaffTheme = keyof typeof STAFF_THEMES;

export const STAFF_THEME_COOKIE = "staff_theme";

export const isStaffTheme = (v: unknown): v is StaffTheme => typeof v === "string" && Object.hasOwn(STAFF_THEMES, v);
