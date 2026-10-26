/** Оценка звёздами: n закрашенных из 5. */
export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} из 5`}>
      {"★★★★★".slice(0, n)}
      <span className="stars__off">{"★★★★★".slice(n)}</span>
    </span>
  );
}
