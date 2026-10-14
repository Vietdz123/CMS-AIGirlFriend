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
           sp.spend_micros, sp.local_spend_micros, sp.installs
    FROM ${t.campaign} c
    JOIN ${t.account} acc ON acc.id = c."accountId"
    LEFT JOIN LATERAL (SELECT MIN(a.id) AS id FROM "App" a WHERE a."storeId" = c."storeId") auto ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(s."spendMicros")::bigint AS spend_micros,
             SUM(s."localSpendMicros")::bigint AS local_spend_micros,
             SUM(s.installs)::bigint AS installs
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
