#!/usr/bin/env python3
"""
Nạp lịch sử chi phí (bảng SpendSnapshot) từ các bản sao lưu pg_dump cũ, để trang "Biến động chi phí" có số của các
ngày trước khi tính năng ghi lịch sử được bật. Chỉ đọc file sao lưu; in ra SQL INSERT để chạy bằng psql.
Thời điểm ghi nhận = thời điểm trong tên file (giờ Việt Nam). Bỏ qua bản sao lưu chưa có cột source/convValueMicros.

  python3 -I scripts/seed-spend-history.py backups/*.sql.gz backups/daily/*.sql.gz > backups/seed.sql
"""
import gzip
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta


def adspend(path):
    opener = gzip.open if path.endswith('.gz') else open
    cols, rows, inside = None, [], False
    with opener(path, 'rt', encoding='utf-8') as f:
        for line in f:
            if not inside:
                if line.startswith('COPY public."AdSpendStat"'):
                    cols = [c.strip().strip('"') for c in line[line.index('(') + 1:line.index(')')].split(',')]
                    inside = True
                continue
            if line.startswith('\\.'):
                break
            rows.append(dict(zip(cols, line.rstrip('\n').split('\t'))))
    return cols or [], rows


def captured_at(path):
    m = re.search(r'(\d{8})-(\d{4})', path)
    if not m:
        return None
    local = datetime.strptime(m.group(1) + m.group(2), '%Y%m%d%H%M')
    return local - timedelta(hours=7)  # giờ Việt Nam -> UTC


snapshots = []
for path in sys.argv[1:]:
    at = captured_at(path)
    cols, rows = adspend(path)
    if not at or 'source' not in cols or 'convValueMicros' not in cols:
        print(f'-- bo qua {path}', file=sys.stderr)
        continue
    totals = defaultdict(lambda: [0, 0, 0])
    for r in rows:
        t = totals[(r['source'], r['accountId'], r['date'])]
        t[0] += int(r['spendMicros']); t[1] += int(r['convValueMicros']); t[2] += int(r['installs'])
    snapshots.append((at, path, totals))
    print(f'-- {path}: {len(totals)} ngay x tai khoan, luc {at} UTC', file=sys.stderr)

# Theo thời gian; chỉ ghi khi số khác lần ghi trước của cùng (kênh, tài khoản, ngày).
snapshots.sort()
last = {}
print('BEGIN;')
for at, path, totals in snapshots:
    for (source, account, date), (spend, conv, inst) in sorted(totals.items()):
        k = (source, account, date)
        if last.get(k) == (spend, conv, inst):
            continue
        last[k] = (spend, conv, inst)
        print(f'INSERT INTO "SpendSnapshot" ("source","accountId","date","spendMicros","convValueMicros","installs","capturedAt") '
              f"VALUES ('{source}','{account}','{date}',{spend},{conv},{inst},'{at:%Y-%m-%d %H:%M:%S}');")
print('COMMIT;')
