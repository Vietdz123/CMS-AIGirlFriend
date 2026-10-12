import { ForbiddenException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from './decorators';

/** Phân quyền theo app: ADMIN xem tất cả, MANAGER/VIEWER chỉ xem app được gán. */
@Injectable()
export class AppAccessService {
  constructor(private prisma: PrismaService) {}

  /** null = không giới hạn (admin). */
  async allowedAppIds(user: AuthUser): Promise<string[] | null> {
    if (user.role === Role.ADMIN) return null;
    const rows = await this.prisma.userAppAccess.findMany({
      where: { userId: user.id },
      select: { appId: true },
    });
    return rows.map((r) => r.appId);
  }

  /** Giao giữa app user yêu cầu và app user được phép xem. */
  async resolveAppIds(user: AuthUser, requested?: string[]): Promise<string[] | null> {
    const allowed = await this.allowedAppIds(user);
    if (allowed === null) return requested?.length ? requested : null;
    if (!requested?.length) return allowed;
    const denied = requested.filter((id) => !allowed.includes(id));
    if (denied.length) throw new ForbiddenException('Không có quyền xem app này');
    return requested;
  }

  /** Các tài khoản AdMob mà user có ít nhất 1 app được gán. */
  async allowedAccountIds(user: AuthUser): Promise<string[] | null> {
    const appIds = await this.allowedAppIds(user);
    if (appIds === null) return null;
    const apps = await this.prisma.app.findMany({
      where: { id: { in: appIds } },
      select: { accountId: true },
      distinct: ['accountId'],
    });
    return apps.map((a) => a.accountId);
  }
}
