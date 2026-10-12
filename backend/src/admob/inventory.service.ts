import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../prisma/prisma.service';
import { AdmobApiService } from './admob-api.service';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private api: AdmobApiService,
    private prisma: PrismaService,
  ) {}

  /** Đồng bộ danh sách app + ad unit (tên, format, package name). */
  async sync(accountId: string, publisherId: string, client: OAuth2Client) {
    const [apps, adUnits] = await Promise.all([
      this.api.listApps(client, publisherId),
      this.api.listAdUnits(client, publisherId),
    ]);
    for (const a of apps) {
      const data = {
        accountId,
        name: a.linkedAppInfo?.displayName ?? a.manualAppInfo?.displayName ?? a.appId,
        platform: a.platform,
        storeId: a.linkedAppInfo?.appStoreId ?? null,
      };
      await this.prisma.app.upsert({ where: { id: a.appId }, create: { id: a.appId, ...data }, update: data });
    }
    for (const u of adUnits) {
      if (!apps.some((a) => a.appId === u.appId)) continue;
      const data = { accountId, appId: u.appId, name: u.displayName, format: u.adFormat };
      await this.prisma.adUnit.upsert({ where: { id: u.adUnitId }, create: { id: u.adUnitId, ...data }, update: data });
    }
    this.logger.log(`Inventory ${publisherId}: ${apps.length} apps, ${adUnits.length} ad units`);
  }
}
