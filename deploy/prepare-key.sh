#!/usr/bin/env bash
# Готовит SSH-ключ для выката из переменной SSH_PRIVATE_KEY (секрет GitHub).
#   prepare-key.sh <куда записать ключ>
# Убирает переводы строк Windows (\r), проверяет, что это целый закрытый ключ,
# и печатает его отпечаток — отпечаток не секретный, по нему ключ можно сверить.
# Сам ключ никогда не выводится.

set -euo pipefail

out="${1:?укажите файл для ключа}"
umask 077

fail() {
  echo "::error::$1"
  echo "Как исправить: на Mac выполните  pbcopy < ~/.ssh/deploy_key  и вставьте (Cmd+V) в секрет SSH_PRIVATE_KEY окружения production. Подробно — docs/vykat.md."
  rm -f "$out"
  exit 1
}

if [ -z "${SSH_PRIVATE_KEY:-}" ]; then
  fail "Секрет SSH_PRIVATE_KEY пуст или недоступен этому запуску (проверьте, что он в окружении production и запуск идёт с ветки main)."
fi

printf '%s\n' "$SSH_PRIVATE_KEY" | tr -d '\r' > "$out"
chmod 600 "$out"

if grep -q '^ssh-' "$out"; then
  fail "В секрет вставлена открытая часть ключа (deploy_key.pub), а нужна закрытая (deploy_key, без .pub)."
fi
if ! grep -q -- '-----BEGIN [A-Z ]*PRIVATE KEY-----' "$out" || ! grep -q -- '-----END [A-Z ]*PRIVATE KEY-----' "$out"; then
  fail "Ключ в секрете неполный: нет первой строки «-----BEGIN … PRIVATE KEY-----» или последней «-----END … PRIVATE KEY-----»."
fi

if ! pub=$(ssh-keygen -y -f "$out" 2>/dev/null); then
  fail "Ключ в секрете повреждён: его не удаётся прочитать (обрезан или изменён при вставке)."
fi

fp=$(printf '%s\n' "$pub" | ssh-keygen -lf - -E sha256 | awk '{print $2}')
echo "Ключ в порядке, отпечаток: $fp"
