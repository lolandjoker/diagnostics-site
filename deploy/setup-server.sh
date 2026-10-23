#!/usr/bin/env bash
# Подготовка сервера Ubuntu к работе сайта. Запускать от root:
#   setup-server.sh <домен>
# Безопасно запускать повторно: уже сделанные шаги пропускаются.
#
# Что делает:
#   1. Ставит Docker, git, tmux, файрвол, fail2ban, автообновления.
#   2. Добавляет файл подкачки 2 ГБ (если подкачки нет).
#   3. Ограничивает размер логов Docker.
#   4. Файрвол: открыты только SSH, HTTP, HTTPS; остальное закрыто.
#   5. Автоматические обновления безопасности Ubuntu.
#   6. fail2ban: блокирует адреса, которые подбирают вход по SSH.
#   7. Скачивает код сайта в /opt/diagnostics/app и создаёт .env с паролем базы.
#      Пароль генерируется на сервере и никуда не передаётся.

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

DOMAIN="${1:?укажите домен: setup-server.sh diagnostics-free.com}"
REPO_URL="https://github.com/lolandjoker/diagnostics-site.git"
BASE=/opt/diagnostics
WARNINGS=()

log() { echo "[подготовка] $*"; }
warn() { echo "[ПРЕДУПРЕЖДЕНИЕ] $*"; WARNINGS+=("$*"); }

# apt с ожиданием: если в этот момент идут автообновления, ждём, а не падаем
apt_() {
  local i
  for i in $(seq 1 20); do
    apt-get -o DPkg::Lock::Timeout=600 "$@" && return 0
    log "apt занят или недоступен — повтор через 30 с (попытка $i из 20)"
    sleep 30
  done
  return 1
}

if [ "$(id -u)" -ne 0 ]; then echo "Нужно запускать от root"; exit 1; fi
if ! grep -qi ubuntu /etc/os-release; then echo "Скрипт рассчитан на Ubuntu"; exit 1; fi

mkdir -p "$BASE/state" "$BASE/backups" "$BASE/logs"
chmod 700 "$BASE/backups"

# --- 0. Место на диске ---
free_gb=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
log "Свободно на диске: ${free_gb} ГБ"
if [ "$free_gb" -lt 5 ]; then echo "Меньше 5 ГБ свободного места — остановка"; exit 1; fi

# --- 1. Пакеты ---
need=()
for p in ca-certificates curl git tmux openssl ufw fail2ban python3-systemd unattended-upgrades; do
  dpkg -s "$p" >/dev/null 2>&1 || need+=("$p")
done
command -v docker >/dev/null 2>&1 || need+=(docker.io)
if [ "${#need[@]}" -gt 0 ]; then
  log "Устанавливаю: ${need[*]}"
  apt_ update -q
  apt_ install -y -q "${need[@]}"
fi

if ! docker compose version >/dev/null 2>&1; then
  if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
    apt_ install -y -q docker-compose-v2
  elif apt-cache show docker-compose-plugin >/dev/null 2>&1; then
    apt_ install -y -q docker-compose-plugin
  else
    echo "Не найден пакет docker compose для этой версии Ubuntu"; exit 1
  fi
fi

# --- 2. Настройки Docker: логи не больше 3 файлов по 10 МБ; зеркало, если Docker Hub недоступен ---
if [ ! -f /etc/docker/daemon.json ]; then
  mirrors=""
  hub_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://registry-1.docker.io/v2/ || true)
  if [ "$hub_code" != "401" ] && [ "$hub_code" != "200" ]; then
    # Зеркало хостинга Timeweb: сервер и так у этого провайдера, новых сторон не добавляется
    mirrors=', "registry-mirrors": ["https://dockerhub.timeweb.cloud"]'
    warn "Docker Hub недоступен (код ${hub_code:-нет}) — образы будут качаться через зеркало Timeweb"
  fi
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<JSON
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }${mirrors}
}
JSON
  log "Настройки Docker записаны"
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null
log "Docker: $(docker --version) / $(docker compose version --short)"

# --- 3. Подкачка 2 ГБ ---
if [ -z "$(swapon --show --noheadings)" ]; then
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "Подкачка 2 ГБ включена"
else
  log "Подкачка уже есть: $(swapon --show --noheadings | awk '{print $1, $3}' | tr '\n' ' ')"
fi

# --- 4. Файрвол ---
# awk читает вывод до конца (без раннего exit), а сбой sshd -T не останавливает скрипт —
# тогда остаётся порт 22 по умолчанию
ssh_port=$({ sshd -T 2>/dev/null || true; } | awk '/^port /{p=$2} END{print p}')
ssh_port="${ssh_port:-22}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${ssh_port}/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
# Проверяем, что SSH разрешён, ДО включения — чтобы не закрыть себе вход
if ! ufw show added | grep -q "allow ${ssh_port}/tcp"; then
  echo "SSH (порт ${ssh_port}) не удалось разрешить — файрвол не включаю"; exit 1
fi
ufw --force enable >/dev/null
log "Файрвол включён: открыты ${ssh_port}/tcp (SSH), 80, 443"

# --- 5. Автоматические обновления безопасности ---
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || warn "не удалось включить службу автообновлений"
log "Автообновления безопасности включены"

# --- 6. fail2ban ---
cat > /etc/fail2ban/jail.d/diagnostics.local <<F2B
[sshd]
enabled = true
port = ${ssh_port}
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
F2B
if systemctl restart fail2ban && systemctl is-active --quiet fail2ban; then
  log "fail2ban работает"
else
  warn "fail2ban не запустился — сайт работать будет, но защиту от подбора нужно проверить"
fi

# --- 7. Код сайта и .env ---
if [ ! -d "$BASE/app/.git" ]; then
  git clone --quiet "$REPO_URL" "$BASE/app"
  log "Код сайта скачан в $BASE/app"
fi
if [ ! -f "$BASE/app/.env" ]; then
  umask 077
  {
    echo "SITE_DOMAIN=${DOMAIN}"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  } > "$BASE/app/.env"
  log "Создан .env (пароль базы сгенерирован на сервере)"
fi
chmod 600 "$BASE/app/.env"

touch "$BASE/state/setup.done"
if [ "${#WARNINGS[@]}" -gt 0 ]; then
  log "Готово, но есть предупреждения: ${#WARNINGS[@]}"
else
  log "Готово"
fi
