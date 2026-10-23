#!/usr/bin/env bash
# Запускает долгую команду на сервере внутри tmux и следит за ней из GitHub Actions.
# Если связь оборвётся, команда на сервере продолжит работу, а не прервётся на середине.
#   remote-run.sh <сессия> <журнал> "<команда на сервере>" <таймаут, минут>
# Сессия одна на вид работ («setup», «deploy»): если она уже идёт (например, остался
# прошлый выкат после обрыва) — сначала ждём её окончания, потом запускаем свою.
# Нужны переменные окружения HOST и ключ ~/.ssh/deploy_key.

set -euo pipefail

session="$1"
name="$2"
cmd="$3"
timeout_min="${4:-20}"
log="/opt/diagnostics/logs/${name}.log"
code="/opt/diagnostics/logs/${name}.exit"

ssh_() {
  ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes -o ConnectTimeout=20 \
      -o ServerAliveInterval=15 "root@${HOST:?нет HOST}" "$@"
}

deadline=$(( $(date +%s) + timeout_min * 60 ))

# «=» — точное совпадение имени: иначе tmux найдёт и чужую сессию вроде «deploy-manual»
while ssh_ "tmux has-session -t '=$session' 2>/dev/null"; do
  echo "На сервере ещё идёт предыдущая задача «$session» — жду её окончания"
  if [ "$(date +%s)" -gt "$deadline" ]; then
    echo "::error::Предыдущая задача «$session» не закончилась за $timeout_min мин"
    exit 1
  fi
  sleep 15
done

# Код выхода пишется во временный файл и переименовывается — читатель не увидит половину
ssh_ "rm -f '$code' && : > '$log' && tmux new-session -d -s '$session' \"$cmd >> '$log' 2>&1; echo \\\$? > '$code.tmp' && mv '$code.tmp' '$code'\""

shown=0
while :; do
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
    echo "::error::«$name» не завершилась за $timeout_min мин. Задача продолжает идти на сервере (tmux, сессия $session), журнал: $log"
    exit 1
  fi
  sleep 10
done
