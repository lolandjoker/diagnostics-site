#!/usr/bin/env bash
# Тест для prepare-key.sh: создаёт одноразовый тестовый ключ и проверяет,
# что скрипт принимает правильный ключ и понятно отклоняет испорченные.
# Запуск: bash deploy/test-prepare-key.sh

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

ssh-keygen -q -t ed25519 -N "" -f "$tmp/key" -C test >/dev/null
good=$(cat "$tmp/key")
expected_fp=$(ssh-keygen -lf "$tmp/key.pub" -E sha256 | awk '{print $2}')

pass=0
fail=0
check() { # имя, ожидаемый код (0/1), ожидаемый фрагмент вывода, значение секрета
  local name="$1" want_code="$2" want_text="$3" value="$4" out code
  set +e
  out=$(SSH_PRIVATE_KEY="$value" bash "$here/prepare-key.sh" "$tmp/out" 2>&1)
  code=$?
  set -e
  if [ "$code" -eq "$want_code" ] && grep -qF -- "$want_text" <<<"$out"; then
    echo "ок   — $name"; pass=$((pass + 1))
  else
    echo "СБОЙ — $name (код $code): $out"; fail=$((fail + 1))
  fi
  if [ "$want_code" -ne 0 ] && [ -e "$tmp/out" ]; then
    echo "СБОЙ — $name: после ошибки остался файл ключа"; fail=$((fail + 1))
  fi
}

check "правильный ключ"                 0 "$expected_fp" "$good"
check "переводы строк Windows (CRLF)"   0 "$expected_fp" "$(printf '%s' "$good" | sed 's/$/\r/')"
check "лишние пустые строки в конце"    0 "$expected_fp" "$good"$'\n\n'
check "пустой секрет"                   1 "пуст или недоступен" ""
check "открытая часть вместо закрытой"  1 "открытая часть" "$(cat "$tmp/key.pub")"
check "обрезан конец"                   1 "неполный" "$(head -n 3 "$tmp/key")"
# Портим 5-й символ 3-й строки так, чтобы он гарантированно изменился
line3=$(sed -n 3p "$tmp/key")
c=${line3:4:1}
if [ "$c" = "A" ]; then r="B"; else r="A"; fi
broken=$(awk -v n=3 -v l="${line3:0:4}${r}${line3:5}" 'NR==n{print l; next} {print}' "$tmp/key")
check "испорчена середина"              1 "повреждён" "$broken"
check "случайный текст"                 1 "неполный" "привет"

ssh-keygen -q -t ed25519 -N "pw-test" -f "$tmp/key_pw" -C test >/dev/null
check "ключ с паролем"                  1 "защищён паролем" "$(cat "$tmp/key_pw")"
check "пустая строка и пробелы по краям" 0 "$expected_fp" $'\n  '"$(sed 's/$/  /' "$tmp/key")"

# Ключ не должен попадать в вывод
out=$(SSH_PRIVATE_KEY="$good" bash "$here/prepare-key.sh" "$tmp/out" 2>&1)
if grep -q "PRIVATE KEY" <<<"$out" || grep -qF "$(sed -n 2p "$tmp/key")" <<<"$out"; then
  echo "СБОЙ — ключ попал в вывод"; fail=$((fail + 1))
else
  echo "ок   — ключ не выводится"; pass=$((pass + 1))
fi

echo "Итого: $pass прошло, $fail не прошло"
[ "$fail" -eq 0 ]
