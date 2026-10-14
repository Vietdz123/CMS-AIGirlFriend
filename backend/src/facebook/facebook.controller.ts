import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { allowedAdAccountIds, campaignPackages, listCampaigns } from '../common/ad-campaigns';
import { encrypt } from '../common/crypto';
import { isIsoDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookApiService } from './facebook-api.service';
import { FacebookSyncService } from './facebook-sync.service';

class TokenDto {
  @IsString()
  @MinLength(20)
  token: string;
}

class ConnectDto extends TokenDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  accountIds: string[];
}

class CampaignAppDto {
  @IsOptional()
  @IsString()
  appId?: string | null;
}

@Controller('facebook')
export class FacebookController {
  constructor(
    private prisma: PrismaService,
    private api: FacebookApiService,
    private sync: FacebookSyncService,
    private access: AppAccessService,
  ) {}

  /** Kiểm tra token và liệt kê các tài khoản quảng cáo token xem được. Token không được lưu ở bước này. */
  @Roles(Role.ADMIN)
  @Post('token/check')
  async check(@Body() dto: TokenDto) {
    try {
      return await this.api.adAccounts(dto.token.trim());
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
  }

  @Roles(Role.ADMIN)
  @Post('accounts')
  async connect(@Body() dto: ConnectDto) {
    const token = dto.token.trim();
    let available;
    try {
      available = await this.api.adAccounts(token);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    const selected = available.filter((a) => dto.accountIds.includes(a.id));
    if (!selected.length) throw new BadRequestException('Token không có quyền xem tài khoản quảng cáo đã chọn');
    const tokenEnc = encrypt(token);
    for (const a of selected) {
      const data = { name: a.name, currencyCode: a.currency, timeZone: a.timezone_name, tokenEnc, lastError: null };
      await this.prisma.fbAdAccount.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
      this.sync.startInitial(a.id);
    }
    return { connected: selected.map((a) => a.id) };
  }

  @Get('accounts')
  async accounts(@CurrentUser() user: AuthUser) {
    const allowed = await allowedAdAccountIds(this.prisma, 'facebook', await this.access.allowedAppIds(user));
    const accounts = await this.prisma.fbAdAccount.findMany({
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
      this.prisma.adSpendStat.deleteMany({ where: { source: 'facebook', accountId: id } }),
      this.prisma.fbAdAccount.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync')
  async trigger() {
    return { started: await this.sync.startManual() };
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
    return listCampaigns(this.prisma, 'facebook', {
      from: q.from,
      to: q.to,
      storeIds: q.storeIds?.split(',').filter(Boolean),
      allowedAppIds: await this.access.allowedAppIds(user),
    });
  }

  @Get('packages')
  async packages(@CurrentUser() user: AuthUser) {
    return campaignPackages(this.prisma, 'facebook', await this.access.allowedAppIds(user));
  }

  @Roles(Role.ADMIN)
  @Patch('campaigns/:id')
  async setCampaignApp(@Param('id') id: string, @Body() dto: CampaignAppDto) {
    await this.prisma.fbCampaign.update({ where: { id }, data: { appId: dto.appId || null } });
    return { ok: true };
  }
}
