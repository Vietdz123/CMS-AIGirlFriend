import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

const userSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  createdAt: true,
  appAccess: { select: { appId: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({ select: userSelect, orderBy: { createdAt: 'asc' } });
    return users.map(({ appAccess, ...u }) => ({ ...u, appIds: appAccess.map((a) => a.appId) }));
  }

  async create(dto: { email: string; name: string; password: string; role: Role; appIds?: string[] }) {
    const email = dto.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) {
      throw new ConflictException('Email đã tồn tại');
    }
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
        appAccess: { create: (dto.appIds ?? []).map((appId) => ({ appId })) },
      },
      select: { id: true },
    });
    return user;
  }

  async update(
    id: string,
    dto: { name?: string; password?: string; role?: Role; active?: boolean },
  ) {
    const { password, ...rest } = dto;
    await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
    });
    return { ok: true };
  }

  async setApps(userId: string, appIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.userAppAccess.deleteMany({ where: { userId } }),
      this.prisma.userAppAccess.createMany({ data: appIds.map((appId) => ({ userId, appId })) }),
    ]);
    return { ok: true };
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
  }
}
