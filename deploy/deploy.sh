#!/usr/bin/env bash
# Выкат сайта на сервере. Запускать от root:
#   deploy.sh deploy <полный SHA коммита>   — выкатить версию
#   deploy.sh rollback                      — вернуть предыдущую версию
#   deploy.sh status                        — что сейчас работает
#
# Перед выкатом: проверка места на диске и резервная копия базы.
# Если новая версия не поднялась — автоматически возвращается предыдущая.

set -euo pipefail

BASE=/opt/diagnostics
APP="$BASE/app"
STATE="$BASE/state"
BACKUPS="$BASE/backups"
KEEP_BACKUPS=14

log() { echo "[выкат $(date -u +%H:%M:%S)] $*"; }
compose() { docker compose --project-name diagnostics --project-directory "$APP" "$@"; }

domain() { grep -E '^SITE_DOMAIN=' "$APP/.env" | cut -d= -f2-; }

check_disk() {
  local free_gb
  free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
  log "Свободно на диске: ${free_gb} ГБ"
  if [ "$free_gb" -lt 3 ]; then log "Меньше 3 ГБ — выкат остановлен"; exit 1; fi
}

backup_db() {
  if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
    local cur f
    cur=$(cut -c1-7 "$STATE/current_sha" 2>/dev/null || echo none)
    f="$BACKUPS/db-$(date -u +%Y%m%d-%H%M%S)-${cur}.sql.gz"
    compose exec -T postgres pg_dump -U diag diag | gzip > "$f"
    if ! gzip -t "$f" || [ "$(gzip -dc "$f" | head -c 64 | wc -c)" -eq 0 ]; then
      log "Резервная копия повреждена или пуста — выкат остановлен"; exit 1
    fi
    log "Резервная копия базы: $f ($(du -h "$f" | cut -f1))"
    # Храним последние $KEEP_BACKUPS копий перед выкатами
    { ls -1t "$BACKUPS"/db-*.sql.gz 2>/dev/null || true; } | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  else
    log "База ещё не запущена — резервную копию делать не из чего"
  fi
}

wait_healthy() {
  local d web status
  d=$(domain)
  for i in $(seq 1 60); do
    web=$(compose ps -q web)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$web" 2>/dev/null || echo нет)
    if [ "$status" = "healthy" ] &&
       curl -fsS --max-time 10 --resolve "${d}:443:127.0.0.1" "https://${d}/api/health" >/dev/null 2>&1; then
      log "Сайт отвечает по https://${d}"
      return 0
    fi
    [ $((i % 6)) -eq 0 ] && log "жду запуска… сайт: ${status}"
    sleep 5
  done
  log "Сайт не ответил за 5 минут"
  compose ps
  compose logs --tail=50 web caddy || true
  return 1
}

# Внимание: функция вызывается внутри `if`, где `set -e` не действует, —
# поэтому каждая команда проверяется явно.
switch_to() {
  local sha="$1"
  git -C "$APP" fetch --quiet origin "$sha" || { log "Не удалось скачать ${sha:0:7}"; return 1; }
  # Без --force: если на сервере кто-то правил файлы вручную — остановимся, а не сотрём правки
  git -C "$APP" checkout --quiet --detach "$sha" || { log "Не удалось переключиться на ${sha:0:7}"; return 1; }
  [ "$(git -C "$APP" rev-parse HEAD)" = "$sha" ] || { log "На сервере не та версия кода"; return 1; }
  compose build --pull web || { log "Сборка не удалась"; return 1; }
  compose up -d --remove-orphans || { log "Запуск не удался"; return 1; }
}

deploy() {
  local sha="${1:-}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo "Нужен полный SHA коммита (40 символов)"; exit 1; }
  [ -f "$APP/.env" ] || { echo "Нет $APP/.env — сначала запустите setup-server.sh"; exit 1; }

  local prev
  prev=$(cat "$STATE/current_sha" 2>/dev/null || true)
  if [ "$prev" = "$sha" ]; then log "Эта версия уже выкачена"; wait_healthy; return 0; fi

  log "Выкатываю ${sha:0:7} (сейчас работает: ${prev:0:7})"
  check_disk
  backup_db

  if switch_to "$sha" && wait_healthy; then
    [ -n "$prev" ] && echo "$prev" > "$STATE/previous_sha"
    echo "$sha" > "$STATE/current_sha"
    docker image prune -f >/dev/null
    log "Готово: работает ${sha:0:7}"
    return 0
  fi

  if [ -n "$prev" ]; then
    log "Новая версия не поднялась — возвращаю ${prev:0:7}"
    switch_to "$prev" && wait_healthy && log "Откат выполнен: работает ${prev:0:7}"
  fi
  exit 1
}

rollback() {
  local prev
  prev=$(cat "$STATE/previous_sha" 2>/dev/null || true)
  [ -n "$prev" ] || { echo "Предыдущей версии нет — откатывать некуда"; exit 1; }
  log "Откат на ${prev:0:7}"
  deploy "$prev"
}

status() {
  echo "Работает версия: $(cat "$STATE/current_sha" 2>/dev/null || echo 'нет')"
  echo "Предыдущая:      $(cat "$STATE/previous_sha" 2>/dev/null || echo 'нет')"
  compose ps
}

case "${1:-}" in
  deploy) deploy "${2:-}" ;;
  rollback) rollback ;;
  status) status ;;
  *) echo "Использование: deploy.sh deploy <sha> | rollback | status"; exit 1 ;;
esac
