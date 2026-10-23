#!/bin/sh
# Sao lưu database mỗi ngày lúc 02:30 giờ Việt Nam, giữ KEEP bản gần nhất trong /backups/daily.
# Chạy trong container "backup" (docker-compose.server.yml); kết nối Postgres qua PGHOST/PGUSER/PGPASSWORD/PGDATABASE.
set -o pipefail

DIR=/backups/daily
KEEP=${KEEP:-14}
# 02:30 giờ VN = 19:30 UTC. Tính theo UTC để không cần dữ liệu múi giờ trong image.
RUN_UTC_SECONDS=$((19 * 3600 + 30 * 60))
# Tên file theo giờ VN; chuỗi TZ POSIX nên không cần /usr/share/zoneinfo.
VN_TZ='<+07>-7'

mkdir -p "$DIR"

log() { echo "[backup $(TZ=$VN_TZ date '+%Y-%m-%d %H:%M:%S')] $*"; }

backup() {
  name="auto-$(TZ=$VN_TZ date +%Y%m%d-%H%M).sql.gz"
  tmp="$DIR/.$name.tmp"
  if pg_dump --no-owner | gzip > "$tmp" && gzip -t "$tmp" && [ "$(wc -c < "$tmp")" -gt 1000 ]; then
    mv "$tmp" "$DIR/$name"
    log "đã lưu $name ($(wc -c < "$DIR/$name") bytes)"
  else
    rm -f "$tmp"
    log "LỖI: sao lưu thất bại"
    return 1
  fi
  # Giữ KEEP bản mới nhất.
  ls -1t "$DIR"/auto-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" && log "xoá bản cũ $(basename "$old")"
  done
}

# Khởi động mà hôm nay (giờ VN) chưa có bản nào thì sao lưu ngay.
today=$(TZ=$VN_TZ date +%Y%m%d)
ls "$DIR"/auto-"$today"-*.sql.gz >/dev/null 2>&1 || backup

while true; do
  now=$(date -u +%s)
  next=$((now - now % 86400 + RUN_UTC_SECONDS))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  log "lần sao lưu tiếp theo sau $(((next - now) / 60)) phút"
  sleep $((next - now))
  backup || true
done
