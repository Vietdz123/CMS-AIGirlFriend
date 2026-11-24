import { PrismaService } from '../prisma/prisma.service';
import { toDbDate } from './dates';

const key = (d: Date) => d.toISOString().slice(0, 10);

/** Mốc gốc của 1 ngày: khi ngày đó đã qua 1,5 ngày (12:00 trưa hôm sau theo giờ tài khoản), số đã gần đủ. */
export const BASELINE_HOUR = 12;
/** Các lần ghi cách nhau dưới khoảng này coi là cùng 1 lượt quét (mọi tài khoản ghi gần như cùng lúc). */
const RUN_WINDOW_MS = 10 * 60_000;
/** Mốc theo chiến dịch phải được ghi trong vòng chừng này ngày sau ngày chạy (bản sao lưu 02:30 ngày +2 vẫn hợp lệ). */
const BASELINE_MAX_DAYS = 4;

/** Ngày đã đủ 1,5 ngày tại thời điểm `at` (giờ tài khoản `timeZone`) hay chưa. */
function settled(date: string, at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const day = `${get('year')}-${get('month')}-${get('day')}`;
  const nextDay = new Date(`${date}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const next = nextDay.toISOString().slice(0, 10);
  return day > next || (day === next && Number(get('hour')) >= BASELINE_HOUR);
}

/**
 * Quét 1 lần/ngày (sau 12:00 giờ tài khoản): với mỗi ngày trong [from, to] của 1 tài khoản, nếu tổng chi phí /
 * conversion value / installs khác lần ghi gần nhất thì thêm 1 dòng SpendSnapshot. Ngày không đổi không ghi gì.
 */
export async function recordSpendSnapshots(prisma: PrismaService, source: string, accountId: string, from: string, to: string) {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [current, previous] = await Promise.all([
    prisma.adSpendStat.groupBy({
      by: ['date'],
      where: { source, accountId, date: range },
      _sum: { spendMicros: true, convValueMicros: true, installs: true },
    }),
    prisma.spendSnapshot.findMany({
      where: { source, accountId, date: range },
      orderBy: { capturedAt: 'desc' },
      distinct: ['date'],
    }),
  ]);
  const last = new Map(previous.map((p) => [key(p.date), p]));
  const changed = current
    .map((c) => ({
      source,
      accountId,
      date: c.date,
      spendMicros: c._sum.spendMicros ?? 0n,
      convValueMicros: c._sum.convValueMicros ?? 0n,
      installs: c._sum.installs ?? 0n,
    }))
    .filter((c) => {
      const p = last.get(key(c.date));
      return !p || p.spendMicros !== c.spendMicros || p.convValueMicros !== c.convValueMicros || p.installs !== c.installs;
    });
  if (changed.length) await prisma.spendSnapshot.createMany({ data: changed });
}

export interface SpendChange {
  date: string;
  source: string;
  /**
   * Mốc gốc: lần ghi đầu tiên khi ngày đã qua 1,5 ngày (12:00 trưa hôm sau, giờ tài khoản), và lần ghi mới nhất, USD.
   * null khi ngày chưa đủ 1,5 ngày.
   */
  first: { spend: number; convValue: number; installs: number; at: string } | null;
  latest: { spend: number; convValue: number; installs: number; at: string };
  /** Mọi lần số của ngày thay đổi, cũ → mới; early = ghi khi ngày chưa đủ 1,5 ngày (số còn về thêm). */
  versions: { at: string; spend: number; convValue: number; installs: number; early: boolean }[];
}

/**
 * Lịch sử chi phí của từng ngày trong [from, to] theo kênh: mỗi lần ghi là tổng mọi tài khoản của kênh tại thời điểm
 * đó (tài khoản nào chưa đổi thì giữ số lần ghi trước của nó).
 */
export async function spendHistory(
  prisma: PrismaService,
  q: { from: string; to: string; sources?: string[]; accountIds?: string[] | null; timeZones: Map<string, string> },
): Promise<SpendChange[]> {
  const rows = await prisma.spendSnapshot.findMany({
    where: {
      date: { gte: toDbDate(q.from), lte: toDbDate(q.to) },
      ...(q.sources?.length ? { source: { in: q.sources } } : {}),
      ...(q.accountIds ? { accountId: { in: q.accountIds } } : {}),
    },
    orderBy: { capturedAt: 'asc' },
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${key(r.date)}|${r.source}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const usd = (v: bigint) => Number(v) / 1e6;
  const out: SpendChange[] = [];
  for (const [k, list] of groups) {
    const [date, source] = k.split('|');
    // Cộng dồn theo thời gian: giữ số mới nhất của từng tài khoản. Các dòng của cùng 1 lượt quét (nhiều tài khoản ghi
    // cách nhau vài mili giây) gộp thành 1 phiên bản, để mốc không chỉ chứa số của tài khoản ghi trước.
    const byAccount = new Map<string, (typeof list)[number]>();
    const versions: SpendChange['versions'] = [];
    const runs: (typeof list)[] = [];
    for (const r of list) {
      const run = runs.at(-1);
      if (run && r.capturedAt.getTime() - run[0].capturedAt.getTime() < RUN_WINDOW_MS) run.push(r);
      else runs.push([r]);
    }
    for (const run of runs) {
      for (const r of run) byAccount.set(r.accountId, r);
      const r = run.at(-1)!;
      const all = [...byAccount.values()];
      const v = {
        early: run.some((x) => !settled(date, x.capturedAt, q.timeZones.get(x.accountId) ?? 'UTC')),
        at: r.capturedAt.toISOString(),
        spend: all.reduce((s, x) => s + usd(x.spendMicros), 0),
        convValue: all.reduce((s, x) => s + usd(x.convValueMicros), 0),
        installs: all.reduce((s, x) => s + Number(x.installs), 0),
      };
      // Bỏ phiên bản trùng số với phiên bản trước (ví dụ số nạp từ bản sao lưu trùng với lần đồng bộ sau đó).
      const prev = versions.at(-1);
      if (prev && prev.early === v.early && prev.spend === v.spend && prev.convValue === v.convValue && prev.installs === v.installs) continue;
      versions.push(v);
    }
    const first = versions.find((v) => !v.early);
    const latest = versions.at(-1)!;
    out.push({
      date,
      source,
      first: first ? { spend: first.spend, convValue: first.convValue, installs: first.installs, at: first.at } : null,
      latest: { spend: latest.spend, convValue: latest.convValue, installs: latest.installs, at: latest.at },
      versions,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.source.localeCompare(b.source));
}

/**
 * Như recordSpendSnapshots nhưng theo từng chiến dịch: với mỗi (ngày, chiến dịch) của 1 tài khoản trong [from, to],
 * nếu tổng chi phí / conversion value / installs khác lần ghi gần nhất thì thêm 1 dòng CampaignSpendSnapshot.
 */
export async function recordCampaignSpendSnapshots(prisma: PrismaService, source: string, accountId: string, from: string, to: string) {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [current, previous] = await Promise.all([
    prisma.adSpendStat.groupBy({
      by: ['date', 'campaignId'],
      where: { source, accountId, date: range },
      _sum: { spendMicros: true, convValueMicros: true, installs: true },
    }),
    prisma.campaignSpendSnapshot.findMany({
      where: { source, accountId, date: range },
      orderBy: { capturedAt: 'desc' },
      distinct: ['date', 'campaignId'],
    }),
  ]);
  const last = new Map(previous.map((p) => [`${key(p.date)}|${p.campaignId}`, p]));
  const changed = current
    .map((c) => ({
      source,
      accountId,
      campaignId: c.campaignId,
      date: c.date,
      spendMicros: c._sum.spendMicros ?? 0n,
      convValueMicros: c._sum.convValueMicros ?? 0n,
      installs: c._sum.installs ?? 0n,
    }))
    .filter((c) => {
      const p = last.get(`${key(c.date)}|${c.campaignId}`);
      return !p || p.spendMicros !== c.spendMicros || p.convValueMicros !== c.convValueMicros || p.installs !== c.installs;
    });
  if (changed.length) await prisma.campaignSpendSnapshot.createMany({ data: changed });
}

export interface CampaignSpendChange {
  campaignId: string;
  name: string;
  /** Tổng chi phí mốc 1,5 ngày và hiện tại (USD) của các ngày trong khoảng đã có mốc. */
  first: number;
  latest: number;
  /** Số ngày có mốc; số ngày bị điều chỉnh. */
  days: number;
  changedDays: number;
  /** Từng ngày: mốc → hiện tại. */
  byDate: { date: string; first: number; latest: number }[];
}

/**
 * Chi phí từng chiến dịch: mốc 1,5 ngày (lần ghi đầu tiên sau 12:00 trưa hôm sau, giờ tài khoản) so với lần ghi mới
 * nhất. Ngày chưa đủ 1,5 ngày bị bỏ qua.
 */
export async function campaignSpendHistory(
  prisma: PrismaService,
  q: { from: string; to: string; source: string; accountIds?: string[] | null; timeZones: Map<string, string> },
): Promise<CampaignSpendChange[]> {
  const rows = await prisma.campaignSpendSnapshot.findMany({
    where: {
      source: q.source,
      date: { gte: toDbDate(q.from), lte: toDbDate(q.to) },
      ...(q.accountIds ? { accountId: { in: q.accountIds } } : {}),
    },
    orderBy: { capturedAt: 'asc' },
  });
  const names = new Map(
    (await prisma.gadsCampaign.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.campaignId))] } }, select: { id: true, name: true } }))
      .map((c) => [c.id, c.name]),
  );
  const usd = (v: bigint) => Number(v) / 1e6;
  // (chiến dịch, ngày) -> mốc + mới nhất.
  const cells = new Map<string, { campaignId: string; date: string; first: number | null; latest: number; stale: boolean }>();
  for (const r of rows) {
    const date = key(r.date);
    const k = `${r.campaignId}|${date}`;
    const c = cells.get(k) ?? { campaignId: r.campaignId, date, first: null as number | null, latest: 0, stale: false };
    // Mốc chỉ hợp lệ khi ghi trong vòng BASELINE_MAX_DAYS sau ngày chạy; ghi muộn hơn thì Google đã điều chỉnh xong,
    // so với số hiện tại sẽ ra chênh lệch gần 0 (sai), nên coi như ngày đó không có mốc.
    const fresh = r.capturedAt.getTime() <= new Date(`${date}T00:00:00Z`).getTime() + BASELINE_MAX_DAYS * 86_400_000;
    if (c.first === null && c.stale === false && settled(date, r.capturedAt, q.timeZones.get(r.accountId) ?? 'UTC')) {
      if (fresh) c.first = usd(r.spendMicros);
      else c.stale = true;
    }
    c.latest = usd(r.spendMicros);
    cells.set(k, c);
  }
  const out = new Map<string, CampaignSpendChange>();
  for (const c of cells.values()) {
    if (c.first === null) continue;
    const o = out.get(c.campaignId) ?? { campaignId: c.campaignId, name: names.get(c.campaignId) ?? c.campaignId, first: 0, latest: 0, days: 0, changedDays: 0, byDate: [] };
    o.first += c.first;
    o.latest += c.latest;
    o.days += 1;
    if (Math.abs(c.latest - c.first) >= 0.005) o.changedDays += 1;
    o.byDate.push({ date: c.date, first: c.first, latest: c.latest });
    out.set(c.campaignId, o);
  }
  for (const o of out.values()) o.byDate.sort((a, b) => b.date.localeCompare(a.date));
  return [...out.values()].sort((a, b) => (a.latest - a.first) - (b.latest - b.first));
}
