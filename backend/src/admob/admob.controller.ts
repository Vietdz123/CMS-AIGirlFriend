import { Controller, Delete, Get, Param, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser, Public, Roles } from '../auth/decorators';
import { GoogleAdsSyncService } from '../google-ads/google-ads-sync.service';
import { GADS_OAUTH_PURPOSE, GoogleAdsService } from '../google-ads/google-ads.service';
import { PrismaService } from '../prisma/prisma.service';
import { SyncService } from '../sync/sync.service';
import { AdmobService } from './admob.service';

@Controller('admob')
export class AdmobController {
  constructor(
    private admob: AdmobService,
    private prisma: PrismaService,
    private access: AppAccessService,
    private sync: SyncService,
    private gads: GoogleAdsService,
    private gadsSync: GoogleAdsSyncService,
  ) {}

  @Roles(Role.ADMIN)
  @Get('oauth/url')
  async oauthUrl(@CurrentUser() user: AuthUser) {
    return { url: await this.admob.authUrl(user.id) };
  }

  /** Google redirect về đây, sau đó chuyển hướng người dùng về frontend. */
  @Public()
  @Get('oauth/callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    if (error) return res.redirect(this.admob.frontendUrl(`/accounts?error=${encodeURIComponent(error)}`));
    let page = '/accounts';
    try {
      const purpose = await this.admob.verifyState(state);
      if (purpose === GADS_OAUTH_PURPOSE) {
        page = '/google-ads';
        const ids = await this.gads.handleCallback(code);
        ids.forEach((id) => this.gadsSync.startInitial(id));
      } else {
        const ids = await this.admob.handleCallback(code);
        // Lần đầu kết nối: backfill dữ liệu lịch sử ở background.
        ids.forEach((id) => this.sync.startInitial(id));
      }
      return res.redirect(this.admob.frontendUrl(`${page}?connected=1`));
    } catch (e: any) {
      return res.redirect(this.admob.frontendUrl(`${page}?error=${encodeURIComponent(e.message)}`));
    }
  }

  @Get('accounts')
  async accounts(@CurrentUser() user: AuthUser) {
    const allowed = await this.access.allowedAccountIds(user);
    const accounts = await this.prisma.admobAccount.findMany({
      where: allowed === null ? {} : { id: { in: allowed } },
      select: {
        id: true,
        publisherId: true,
        name: true,
        currencyCode: true,
        timeZone: true,
        lastSyncedAt: true,
        createdAt: true,
        _count: { select: { apps: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return accounts;
  }

  @Roles(Role.ADMIN)
  @Delete('accounts/:id')
  async removeAccount(@Param('id') id: string) {
    await this.prisma.$transaction([
      this.prisma.unitStat.deleteMany({ where: { accountId: id } }),
      this.prisma.sourceStat.deleteMany({ where: { accountId: id } }),
      this.prisma.admobAccount.delete({ where: { id } }),
    ]);
    return { ok: true };
  }

  @Get('apps')
  async apps(@CurrentUser() user: AuthUser) {
    const allowed = await this.access.allowedAppIds(user);
    return this.prisma.app.findMany({
      where: allowed === null ? {} : { id: { in: allowed } },
      select: {
        id: true,
        name: true,
        platform: true,
        storeId: true,
        account: { select: { id: true, publisherId: true, name: true } },
        _count: { select: { adUnits: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
}
