#!/usr/bin/env bash
# Запускает долгую команду на сервере внутри tmux и следит за ней из GitHub Actions.
# Если связь оборвётся, команда на сервере продолжит работу, а не прервётся на середине.
#   remote-run.sh <имя> "<команда на сервере>" <таймаут, минут>
# Нужны переменные окружения HOST и ключ ~/.ssh/deploy_key.

set -euo pipefail

name="$1"
cmd="$2"
timeout_min="${3:-20}"
log="/opt/diagnostics/logs/${name}.log"
code="/opt/diagnostics/logs/${name}.exit"

ssh_() {
  ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes -o ConnectTimeout=20 \
      -o ServerAliveInterval=15 "root@${HOST:?нет HOST}" "$@"
}

# Если такая же задача уже идёт (например, после обрыва) — не запускаем вторую
if ssh_ "tmux has-session -t '$name' 2>/dev/null"; then
  echo "Задача «$name» уже идёт на сервере — подключаюсь к ней"
else
  ssh_ "rm -f '$code' && : > '$log' && tmux new-session -d -s '$name' \"$cmd >> '$log' 2>&1; echo \\\$? > '$code'\""
fi

shown=0
deadline=$(( $(date +%s) + timeout_min * 60 ))
while :; do
  # Новые строки журнала
  total=$(ssh_ "wc -l < '$log'" || echo "$shown")
  if [ "$total" -gt "$shown" ]; then
    ssh_ "sed -n '$((shown + 1)),${total}p' '$log'" || true
    shown=$total
  fi
  if ssh_ "test -f '$code'"; then
    exit_code=$(ssh_ "cat '$code'")
    ssh_ "sed -n '$((shown + 1)),\$p' '$log'" || true
    if [ "$exit_code" = "0" ]; then echo "«$name» — успешно"; exit 0; fi
    echo "::error::«$name» завершилась с ошибкой (код $exit_code). Журнал на сервере: $log"
    exit 1
  fi
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "::error::«$name» не завершилась за $timeout_min мин. Задача продолжает идти на сервере в tmux ($name), журнал: $log"
    exit 1
  fi
  sleep 10
done
