import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, toDbDate } from './dates';

/** 1 lần đổi budget: từ thời điểm `at` (ngày theo múi giờ tài khoản) budget là `newMicros`, trước đó là `oldMicros`. */
export interface BudgetChange {
  campaignId: string;
  date: string; // YYYY-MM-DD theo múi giờ tài khoản
  at: string; // thời điểm đầy đủ, để sắp xếp các lần đổi trong cùng ngày
  oldMicros: bigint | null; // null = chiến dịch mới tạo
  newMicros: bigint;
}

/**
 * Dựng budget/ngày cho [from, to] từ budget hiện tại và lịch sử thay đổi, rồi ghi đè vào CampaignBudgetDay.
 * Mỗi ngày lấy mức cuối ngày: đi lùi từ hôm nay, mỗi lần đổi ở ngày D thì các ngày trước D dùng giá trị cũ.
 * Lần đổi có oldMicros = null (chiến dịch được tạo ngày D) thì các ngày trước D không có budget.
 * Chiến dịch không có trong `current` (đã xoá, hoặc không có budget/ngày) thì chỉ giữ các dòng đã ghi trước đó.
 */
export async function saveBudgetDays(
  prisma: PrismaService,
  opts: {
    source: 'facebook' | 'google';
    accountId: string;
    currency: string;
    from: string;
    to: string;
    current: Map<string, bigint>;
    changes: BudgetChange[];
    toUsd: (date: string, micros: bigint) => bigint;
  },
) {
  const byCampaign = new Map<string, BudgetChange[]>();
  for (const c of opts.changes) {
    if (!opts.current.has(c.campaignId)) continue;
    byCampaign.set(c.campaignId, [...(byCampaign.get(c.campaignId) ?? []), c]);
  }

  const rows: Prisma.CampaignBudgetDayCreateManyInput[] = [];
  for (const [campaignId, nowMicros] of opts.current) {
    // Mới nhất trước, để đi lùi theo thời gian.
    const changes = (byCampaign.get(campaignId) ?? []).sort((a, b) => b.at.localeCompare(a.at));
    let value: bigint | null = nowMicros;
    let i = 0;
    for (let date = opts.to; date >= opts.from; date = addDays(date, -1)) {
      // Áp các lần đổi xảy ra SAU ngày này: mức cuối ngày `date` là mức trước lần đổi sớm nhất sau ngày đó.
      while (i < changes.length && changes[i].date > date) {
        value = changes[i].oldMicros;
        i++;
      }
      if (value === null) break;
      rows.push({
        source: opts.source,
        accountId: opts.accountId,
        campaignId,
        date: toDbDate(date),
        budgetMicros: opts.toUsd(date, value),
        localBudgetMicros: value,
        currency: opts.currency,
      });
    }
  }

  const ids = [...opts.current.keys()];
  if (!ids.length) return 0;
  await prisma.$transaction([
    prisma.campaignBudgetDay.deleteMany({
      where: {
        source: opts.source,
        campaignId: { in: ids },
        date: { gte: toDbDate(opts.from), lte: toDbDate(opts.to) },
      },
    }),
    prisma.campaignBudgetDay.createMany({ data: rows }),
  ]);
  return rows.length;
}

/** Budget/ngày (USD + tiền gốc) của 1 chiến dịch trong khoảng ngày, theo ngày. */
export async function budgetByDate(
  prisma: PrismaService,
  source: 'facebook' | 'google',
  campaignId: string,
  from: string,
  to: string,
) {
  const rows = await prisma.campaignBudgetDay.findMany({
    where: { source, campaignId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    select: { date: true, budgetMicros: true, localBudgetMicros: true },
  });
  return new Map(rows.map((r) => [
    r.date.toISOString().slice(0, 10),
    { budget: Number(r.budgetMicros) / 1e6, localBudget: Number(r.localBudgetMicros) / 1e6 },
  ]));
}
