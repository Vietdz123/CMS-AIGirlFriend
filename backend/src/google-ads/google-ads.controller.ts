import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import {
  allowedAdAccountIds, campaignDaily, campaignPackages, cohortRoas, cohortRoasCampaigns, listCampaigns, parseRoasDays,
} from '../common/ad-campaigns';
import { isIsoDate, todayIn } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { GOOGLE_SOURCE, GoogleAdsSyncService } from './google-ads-sync.service';
import { GoogleAdsService } from './google-ads.service';

class CampaignAppDto {
  @IsOptional()
  @IsString()
  appId?: string | null;
}

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private prisma: PrismaService,
    private ads: GoogleAdsService,
    private sync: GoogleAdsSyncService,
    private access: AppAccessService,
  ) {}

  /** Link đăng nhập Google; callback dùng chung /api/admob/oauth/callback. */
  @Roles(Role.ADMIN)
  @Get('oauth/url')
  async oauthUrl(@CurrentUser() user: AuthUser) {
    return { url: await this.ads.authUrl(user.id) };
  }

  @Get('accounts')
  async accounts(@CurrentUser() user: AuthUser) {
    const allowed = await allowedAdAccountIds(this.prisma, 'google', await this.access.allowedAppIds(user));
    const accounts = await this.prisma.gadsAccount.findMany({
      where: allowed === null ? {} : { id: { in: allowed } },
      select: {
        id: true,
        name: true,
        currencyCode: true,
        timeZone: true,
        lastSyncedAt: true,
        lastError: true,
        createdAt: true,
        _count: { select: { campaigns: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return accounts.map((a) => ({ ...a, running: this.sync.isRunning(a.id) }));
  }

  @Roles(Role.ADMIN)
  @Delete('accounts/:id')
  async remove(@Param('id') id: string) {
    await this.prisma.$transaction([
      this.prisma.adSpendStat.deleteMany({ where: { source: GOOGLE_SOURCE, accountId: id } }),
      this.prisma.gadsConvLagStat.deleteMany({ where: { accountId: id } }),
      this.prisma.gadsAccount.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync')
  async trigger(@CurrentUser() user: AuthUser, @Body() body: { full?: boolean }) {
    // Tải lại toàn bộ lịch sử tốn nhiều lượt gọi API (quota Explorer 2.880/ngày) nên chỉ admin được dùng.
    if (body?.full && user.role !== Role.ADMIN) throw new ForbiddenException('Chỉ admin được tải lại toàn bộ');
    return { started: await this.sync.startManual(!!body?.full) };
  }

  /**
   * Chiến dịch kèm app được ghép và chi phí trong khoảng ngày. Query: from, to (YYYY-MM-DD), storeIds (phân tách
   * bằng dấu phẩy). Người không phải admin chỉ thấy chiến dịch ghép với app được gán.
   */
  @Get('campaigns')
  async campaigns(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if ((q.from && !isIsoDate(q.from)) || (q.to && !isIsoDate(q.to))) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD');
    }
    return listCampaigns(this.prisma, 'google', {
      from: q.from,
      to: q.to,
      storeIds: q.storeIds?.split(',').filter(Boolean),
      allowedAppIds: await this.access.allowedAppIds(user),
    });
  }

  /** Số liệu từng ngày của 1 chiến dịch: spend, installs, CPI, conversion value, ROAS (Google). */
  @Get('campaigns/:id/daily')
  async daily(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD và from <= to');
    }
    // Người không phải admin chỉ xem được chiến dịch ghép với app được gán.
    const allowed = await this.access.allowedAppIds(user);
    if (allowed !== null) {
      const visible = await listCampaigns(this.prisma, 'google', { allowedAppIds: allowed });
      if (!visible.some((c) => c.id === id)) throw new ForbiddenException('Không có quyền xem chiến dịch này');
    }
    return campaignDaily(this.prisma, 'google', id, q.from, q.to);
  }

  /**
   * ROAS DN theo ngày tương tác quảng cáo. Query: from, to, campaignIds, storeIds, days (mốc N, ví dụ 0,2,11; mặc định
   * 0,1,3,7,14,30) (phân tách bằng dấu phẩy). Người không phải admin chỉ tính trên chiến dịch ghép với app được gán.
   */
  @Get('roas-cohort')
  async roasCohort(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD và from <= to');
    }
    const account = await this.prisma.gadsAccount.findFirst({ select: { timeZone: true } });
    return cohortRoas(this.prisma, {
      from: q.from,
      to: q.to,
      today: todayIn(account?.timeZone ?? 'UTC'),
      campaignIds: q.campaignIds?.split(',').filter(Boolean),
      storeIds: q.storeIds?.split(',').filter(Boolean),
      allowedAppIds: await this.access.allowedAppIds(user),
      days: parseRoasDays(q.days),
    });
  }

  /** Các chiến dịch chạy trong 1 ngày của bảng ROAS theo ngày. Query: date (YYYY-MM-DD), campaignIds, storeIds. */
  @Get('roas-cohort/campaigns')
  async roasCohortCampaigns(@CurrentUser() user: AuthUser, @Query() q: Record<string, string | undefined>) {
    if (!isIsoDate(q.date)) throw new BadRequestException('date phải có dạng YYYY-MM-DD');
    const account = await this.prisma.gadsAccount.findFirst({ select: { timeZone: true } });
    return cohortRoasCampaigns(this.prisma, {
      date: q.date,
      today: todayIn(account?.timeZone ?? 'UTC'),
      campaignIds: q.campaignIds?.split(',').filter(Boolean),
      storeIds: q.storeIds?.split(',').filter(Boolean),
      allowedAppIds: await this.access.allowedAppIds(user),
      days: parseRoasDays(q.days),
    });
  }

  /** ROAS theo giờ hôm nay của từng chiến dịch, lấy trực tiếp từ Google Ads (trễ tối đa 5 phút). */
  @Get('hourly-today')
  async hourlyToday(@CurrentUser() user: AuthUser) {
    const data = await this.sync.hourlyToday();
    // Người không phải admin chỉ thấy chiến dịch ghép với app được gán.
    const allowed = await this.access.allowedAppIds(user);
    if (allowed === null) return data;
    const visible = new Set((await listCampaigns(this.prisma, 'google', { allowedAppIds: allowed })).map((c) => c.id));
    return { ...data, campaigns: data.campaigns.filter((c) => visible.has(c.id)) };
  }

  @Get('packages')
  async packages(@CurrentUser() user: AuthUser) {
    return campaignPackages(this.prisma, 'google', await this.access.allowedAppIds(user));
  }

  @Roles(Role.ADMIN)
  @Patch('campaigns/:id')
  async setCampaignApp(@Param('id') id: string, @Body() dto: CampaignAppDto) {
    await this.prisma.gadsCampaign.update({ where: { id }, data: { appId: dto.appId || null } });
    return { ok: true };
  }
}
