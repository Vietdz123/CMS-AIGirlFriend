#!/usr/bin/env python3
"""
So sánh doanh thu AdMob và chi phí quảng cáo theo ngày giữa các bản sao lưu database (pg_dump, .sql hoặc .sql.gz).
Chỉ đọc file sao lưu; không đụng vào database đang chạy.

  python3 -I scripts/compare-snapshots.py backups/before-budget-*.sql.gz backups/snapshot-*.sql.gz --from 2026-10-10
"""
import argparse
import gzip
import os
from collections import defaultdict


def copy_blocks(path, tables):
    """Đọc các khối COPY của pg_dump cho các bảng cần, trả về {bảng: (cột, [dòng])}."""
    opener = gzip.open if path.endswith('.gz') else open
    out, current, cols = {}, None, None
    with opener(path, 'rt', encoding='utf-8') as f:
        for line in f:
            if current is None:
                if line.startswith('COPY public.'):
                    name = line.split()[1].split('.', 1)[1].strip('"')
                    if name in tables:
                        current = name
                        cols = [c.strip().strip('"') for c in line[line.index('(') + 1:line.index(')')].split(',')]
                        out[current] = (cols, [])
                continue
            if line.startswith('\\.'):
                current = None
                continue
            out[current][1].append(line.rstrip('\n').split('\t'))
    return out


def daily(path):
    """{ngày: {'rev', 'fb', 'google'}} theo USD."""
    blocks = copy_blocks(path, {'UnitStat', 'AdSpendStat'})
    days = defaultdict(lambda: {'rev': 0.0, 'facebook': 0.0, 'google': 0.0})
    cols, rows = blocks.get('UnitStat', ([], []))
    if rows:
        i_date, i_earn = cols.index('date'), cols.index('earningsMicros')
        for r in rows:
            days[r[i_date]]['rev'] += int(r[i_earn]) / 1e6
    cols, rows = blocks.get('AdSpendStat', ([], []))
    if rows:
        i_date, i_spend = cols.index('date'), cols.index('spendMicros')
        i_src = cols.index('source') if 'source' in cols else None
        for r in rows:
            src = r[i_src] if i_src is not None else 'facebook'
            days[r[i_date]][src] += int(r[i_spend]) / 1e6
    return days


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('snapshots', nargs='+')
    ap.add_argument('--from', dest='start', default='0000-00-00')
    args = ap.parse_args()

    snaps = [(os.path.basename(p), daily(p)) for p in args.snapshots]
    dates = sorted({d for _, days in snaps for d in days if d >= args.start})
    names = [n.replace('.sql.gz', '').replace('.sql', '') for n, _ in snaps]

    print('Profit = Revenue (AdMob) - Spend (Facebook + Google Ads), USD\n')
    print(f"{'ngày':<11}" + ''.join(f'{n[-22:]:>26}' for n in names))
    for d in dates:
        cells = []
        for _, days in snaps:
            v = days.get(d)
            if not v:
                cells.append(f"{'—':>26}")
                continue
            spend = v['facebook'] + v['google']
            cells.append(f"{v['rev']:>7.2f} -{spend:>7.2f} ={v['rev'] - spend:>+8.2f}")
        print(f'{d:<11}' + ''.join(cells))

    print('\nChênh lệch giữa bản đầu và bản cuối (chỉ ngày có ở cả hai):')
    first, last = snaps[0][1], snaps[-1][1]
    print(f"{'ngày':<11}{'Δ revenue':>12}{'Δ FB spend':>12}{'Δ GG spend':>12}{'Δ profit':>12}")
    tot = defaultdict(float)
    for d in dates:
        if d not in first or d not in last:
            continue
        a, b = first[d], last[d]
        dr, df, dg = b['rev'] - a['rev'], b['facebook'] - a['facebook'], b['google'] - a['google']
        dp = dr - df - dg
        if max(abs(dr), abs(df), abs(dg)) < 0.005:
            continue
        for k, v in (('rev', dr), ('fb', df), ('gg', dg), ('profit', dp)):
            tot[k] += v
        print(f'{d:<11}{dr:>+12.2f}{df:>+12.2f}{dg:>+12.2f}{dp:>+12.2f}')
    print(f"{'TỔNG':<11}{tot['rev']:>+12.2f}{tot['fb']:>+12.2f}{tot['gg']:>+12.2f}{tot['profit']:>+12.2f}")


if __name__ == '__main__':
    main()
