"use client";

import { useState } from "react";

/** Срок «в сети»: число + единица; при «навсегда» (foreverKey) число не нужно и прячется. */
export function OnlineUnitSelect({ units, foreverKey }: { units: { key: string; label: string }[]; foreverKey: string }) {
  const [unit, setUnit] = useState("hours");
  const forever = unit === foreverKey;
  return (
    <>
      {forever ? (
        <input type="hidden" name="amount" value="0" />
      ) : (
        <input name="amount" type="number" min={1} max={525600} defaultValue={1} required aria-label="Срок" />
      )}
      <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Единица срока">
        {units.map((u) => (
          <option key={u.key} value={u.key}>
            {u.key === foreverKey ? u.label : `на ${u.label}`}
          </option>
        ))}
      </select>
    </>
  );
}
