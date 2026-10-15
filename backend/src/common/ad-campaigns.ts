import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CampaignQuery {
  from?: string;
  to?: string;
  /** Lọc theo package name của chiến dịch. */
  storeIds?: string[];
  /** null = mọi chiến dịch (admin); mảng = chỉ chiến dịch đã ghép với các app này (gán tay hoặc tự động). */
  allowedAppIds: string[] | null;
}

interface CampaignRow {
  id: string;
  name: string;
  storeId: string | null;
  appId: string | null;
  auto_app_id: string | null;
  account_id: string;
  account_name: string;
  spend_micros: bigint | null;
  local_spend_micros: bigint | null;
  installs: bigint | null;
  conv_value_micros: bigint | null;
}

const TABLES = {
  facebook: { campaign: Prisma.raw('"FbCampaign"'), account: Prisma.raw('"FbAdAccount"') },
  google: { campaign: Prisma.raw('"GadsCampaign"'), account: Prisma.raw('"GadsAccount"') },
};

/**
 * Danh sách chiến dịch Facebook / Google Ads kèm app được ghép và chi phí (USD + tiền gốc) trong khoảng ngày.
 * App tự động = app AdMob có cùng package (nhiều app trùng package thì lấy id nhỏ nhất, giống ReportsService).
 */
export async function listCampaigns(prisma: PrismaService, source: 'facebook' | 'google', q: CampaignQuery) {
  const t = TABLES[source];
  const spendFilter = [Prisma.sql`s.source = ${source}`, Prisma.sql`s."campaignId" = c.id`];
  if (q.from) spendFilter.push(Prisma.sql`s.date >= ${q.from}::date`);
  if (q.to) spendFilter.push(Prisma.sql`s.date <= ${q.to}::date`);

  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.storeIds?.length) where.push(Prisma.sql`c."storeId" IN (${Prisma.join(q.storeIds)})`);
  if (q.allowedAppIds !== null) {
    where.push(
      q.allowedAppIds.length
        ? Prisma.sql`COALESCE(c."appId", auto.id) IN (${Prisma.join(q.allowedAppIds)})`
        : Prisma.sql`FALSE`,
    );
  }

  const rows = await prisma.$queryRaw<CampaignRow[]>`
    SELECT c.id, c.name, c."storeId", c."appId", auto.id AS auto_app_id,
           acc.id AS account_id, acc.name AS account_name,
           sp.spend_micros, sp.local_spend_micros, sp.installs, sp.conv_value_micros
    FROM ${t.campaign} c
    JOIN ${t.account} acc ON acc.id = c."accountId"
    LEFT JOIN LATERAL (SELECT MIN(a.id) AS id FROM "App" a WHERE a."storeId" = c."storeId") auto ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(s."spendMicros")::bigint AS spend_micros,
             SUM(s."localSpendMicros")::bigint AS local_spend_micros,
             SUM(s.installs)::bigint AS installs,
             SUM(s."convValueMicros")::bigint AS conv_value_micros
      FROM "AdSpendStat" s WHERE ${Prisma.join(spendFilter, ' AND ')}
    ) sp ON TRUE
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY sp.spend_micros DESC NULLS LAST, c.name`;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    storeId: r.storeId,
    appId: r.appId,
    autoAppId: r.auto_app_id,
    account: { id: r.account_id, name: r.account_name },
    totalSpend: Number(r.spend_micros ?? 0) / 1e6,
    localSpend: Number(r.local_spend_micros ?? 0) / 1e6,
    installs: Number(r.installs ?? 0),
    /** Conversion value nền tảng báo (USD); Facebook hiện luôn 0. */
    convValue: Number(r.conv_value_micros ?? 0) / 1e6,
  }));
}

/** Package name có trong các chiến dịch (cho ô lọc), giới hạn theo quyền xem app. */
export async function campaignPackages(prisma: PrismaService, source: 'facebook' | 'google', allowedAppIds: string[] | null) {
  const rows = await listCampaigns(prisma, source, { allowedAppIds });
  return [...new Set(rows.map((r) => r.storeId).filter((s): s is string => !!s))].sort();
}

/** Tài khoản quảng cáo có ít nhất 1 chiến dịch ghép với app user được xem. */
export async function allowedAdAccountIds(
  prisma: PrismaService,
  source: 'facebook' | 'google',
  allowedAppIds: string[] | null,
): Promise<string[] | null> {
  if (allowedAppIds === null) return null;
  const rows = await listCampaigns(prisma, source, { allowedAppIds });
  return [...new Set(rows.map((r) => r.account.id))];
}

/** Số liệu từng ngày của 1 chiến dịch (cộng mọi quốc gia), USD. */
export async function campaignDaily(prisma: PrismaService, source: 'facebook' | 'google', campaignId: string, from: string, to: string) {
  const rows = await prisma.$queryRaw<{
    date: Date;
    spend_micros: bigint;
    local_spend_micros: bigint;
    impressions: bigint;
    clicks: bigint;
    installs: bigint;
    conv_value_micros: bigint;
  }[]>`
    SELECT date,
           SUM("spendMicros")::bigint AS spend_micros,
           SUM("localSpendMicros")::bigint AS local_spend_micros,
           SUM(impressions)::bigint AS impressions,
           SUM(clicks)::bigint AS clicks,
           SUM(installs)::bigint AS installs,
           SUM("convValueMicros")::bigint AS conv_value_micros
    FROM "AdSpendStat"
    WHERE source = ${source} AND "campaignId" = ${campaignId}
      AND date BETWEEN ${from}::date AND ${to}::date
    GROUP BY date ORDER BY date DESC`;
  return rows.map((r) => {
    const spend = Number(r.spend_micros) / 1e6;
    const installs = Number(r.installs);
    const convValue = Number(r.conv_value_micros) / 1e6;
    return {
      date: r.date.toISOString().slice(0, 10),
      spend,
      localSpend: Number(r.local_spend_micros) / 1e6,
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      installs,
      cpi: installs ? spend / installs : null,
      convValue,
      roas: spend ? convValue / spend : null,
    };
  });
}

/** Mốc ROAS kiểu cohort: DN = giá trị phát sinh từ ngày 0 tới hết ngày N (tức (N+1) x 24 giờ kể từ lúc tương tác). */
export const ROAS_DAYS = [0, 1, 3, 7, 14, 30] as const;

/**
 * Các nhóm độ trễ của Google Ads (segments.conversion_lag_bucket) kèm cận trên tính theo ngày. Google chỉ chia
 * từng ngày tới 14 ngày, sau đó là 14–21, 21–30, 30–45…, nên D14 (cần 15 ngày) và D30 (cần 31 ngày) lấy mốc
 * gần nhất bên dưới là 14 và 30 ngày (thiếu ngày cuối).
 */
const LAG_BUCKET_UPPER_DAYS: Record<string, number> = {
  LESS_THAN_ONE_DAY: 1, ONE_TO_TWO_DAYS: 2, TWO_TO_THREE_DAYS: 3, THREE_TO_FOUR_DAYS: 4, FOUR_TO_FIVE_DAYS: 5,
  FIVE_TO_SIX_DAYS: 6, SIX_TO_SEVEN_DAYS: 7, SEVEN_TO_EIGHT_DAYS: 8, EIGHT_TO_NINE_DAYS: 9, NINE_TO_TEN_DAYS: 10,
  TEN_TO_ELEVEN_DAYS: 11, ELEVEN_TO_TWELVE_DAYS: 12, TWELVE_TO_THIRTEEN_DAYS: 13, THIRTEEN_TO_FOURTEEN_DAYS: 14,
  FOURTEEN_TO_TWENTY_ONE_DAYS: 21, TWENTY_ONE_TO_THIRTY_DAYS: 30, THIRTY_TO_FORTY_FIVE_DAYS: 45,
  FORTY_FIVE_TO_SIXTY_DAYS: 60, SIXTY_TO_NINETY_DAYS: 90,
};

/** Với mốc DN: các nhóm độ trễ được cộng và số ngày cửa sổ thực tế (sau khi làm tròn xuống theo nhóm của Google). */
function lagWindow(n: number) {
  const buckets = Object.entries(LAG_BUCKET_UPPER_DAYS).filter(([, upper]) => upper <= n + 1);
  return { buckets: buckets.map(([b]) => b), days: Math.max(...buckets.map(([, upper]) => upper)) };
}

/** partial: cửa sổ chưa đóng, số là tích luỹ tới hiện tại và còn tăng; final: đã đủ ngày, số đã chốt. */
export type RoasStatus = 'partial' | 'final';

export interface CohortRoasQuery {
  from: string;
  to: string;
  /** Hôm nay theo múi giờ tài khoản quảng cáo (cùng múi giờ với segments.date của Google Ads). */
  today: string;
  campaignIds?: string[];
  storeIds?: string[];
  allowedAppIds: string[] | null;
}

/**
 * ROAS theo mốc D0/D1/D3/D7/D14/D30 cho từng ngày tương tác quảng cáo (cộng các chiến dịch khớp bộ lọc), Google Ads.
 * ROAS DN = conversion value phát sinh trong (N+1) x 24 giờ kể từ lúc tương tác / chi phí ngày đó.
 * Lượt tương tác cuối ngày X chỉ hết cửa sổ vào cuối ngày X + số ngày cửa sổ, nên mốc chỉ "final" từ ngày sau đó.
 */
export async function cohortRoas(prisma: PrismaService, q: CohortRoasQuery) {
  const campaigns = await listCampaigns(prisma, 'google', { storeIds: q.storeIds, allowedAppIds: q.allowedAppIds });
  let ids = campaigns.map((c) => c.id);
  if (q.campaignIds?.length) ids = ids.filter((id) => q.campaignIds!.includes(id));
  if (!ids.length) return [];

  const windows = ROAS_DAYS.map((n) => ({ n, ...lagWindow(n) }));
  const dayCols = windows.map((w) =>
    Prisma.sql`SUM(CASE WHEN "lagBucket" IN (${Prisma.join(w.buckets)}) THEN "valueMicros" ELSE 0 END)::bigint AS ${Prisma.raw(`d${w.n}`)}`);
  const [spendRows, lagRows] = await Promise.all([
    prisma.$queryRaw<{ date: Date; spend_micros: bigint; installs: bigint }[]>`
      SELECT date, SUM("spendMicros")::bigint AS spend_micros, SUM(installs)::bigint AS installs
      FROM "AdSpendStat"
      WHERE source = 'google' AND "campaignId" IN (${Prisma.join(ids)})
        AND date BETWEEN ${q.from}::date AND ${q.to}::date
      GROUP BY date`,
    prisma.$queryRaw<({ date: Date; total: bigint } & Record<string, bigint>)[]>`
      SELECT date, SUM("valueMicros")::bigint AS total, ${Prisma.join(dayCols)}
      FROM "GadsConvLagStat"
      WHERE "campaignId" IN (${Prisma.join(ids)})
        AND date BETWEEN ${q.from}::date AND ${q.to}::date
      GROUP BY date`,
  ]);

  const key = (d: Date) => d.toISOString().slice(0, 10);
  const lagByDate = new Map(lagRows.map((r) => [key(r.date), r]));
  const dates = [...new Set([...spendRows.map((r) => key(r.date)), ...lagRows.map((r) => key(r.date))])].sort().reverse();
  const spendByDate = new Map(spendRows.map((r) => [key(r.date), r]));
  const daysSince = (date: string) => Math.round((Date.parse(q.today) - Date.parse(date)) / 86_400_000);

  // Bỏ ngày không có chi phí lẫn doanh thu (chiến dịch tạm dừng, chi phí lẻ do làm tròn tỷ giá).
  const active = dates.filter((date) =>
    Number(spendByDate.get(date)?.spend_micros ?? 0) >= 10_000 || Number(lagByDate.get(date)?.total ?? 0) > 0);

  return active.map((date) => {
    const s = spendByDate.get(date);
    const lag = lagByDate.get(date);
    const spend = Number(s?.spend_micros ?? 0) / 1e6;
    const age = daysSince(date);
    const roas: Record<string, number | null> = {};
    const value: Record<string, number> = {};
    const status: Record<string, RoasStatus> = {};
    for (const w of windows) {
      const k = `d${w.n}`;
      value[k] = Number(lag?.[k] ?? 0) / 1e6;
      roas[k] = spend ? value[k] / spend : null;
      // Mốc chưa đủ ngày vẫn trả số tích luỹ tới hiện tại (luôn D0 ≤ D3 ≤ … vì cửa sổ lồng nhau).
      status[k] = age <= w.days ? 'partial' : 'final';
    }
    return {
      date,
      spend,
      installs: Number(s?.installs ?? 0),
      /** Tổng conversion value tới hiện tại (mọi độ trễ). */
      convValue: Number(lag?.total ?? 0) / 1e6,
      value,
      roas,
      status,
    };
  });
}
