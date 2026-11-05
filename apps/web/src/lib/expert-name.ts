/** «Ксения Никитина | Нумеролог» — до черты имя, после — специализация. */
export function splitExpertName(full: string): { name: string; role: string } {
  const i = full.indexOf("|");
  return i < 0 ? { name: full.trim(), role: "" } : { name: full.slice(0, i).trim(), role: full.slice(i + 1).trim() };
}
