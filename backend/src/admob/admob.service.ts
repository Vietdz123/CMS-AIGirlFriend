import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { encrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ADMOB_SCOPES, AdmobApiService } from './admob-api.service';
import { InventoryService } from './inventory.service';

@Injectable()
export class AdmobService {
  constructor(
    private api: AdmobApiService,
    private inventory: InventoryService,
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async authUrl(userId: string): Promise<string> {
    // state ký bằng JWT để chống CSRF và biết admin nào bắt đầu flow.
    const state = await this.jwt.signAsync({ sub: userId, purpose: 'admob-oauth' }, { expiresIn: '10m' });
    return this.api.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // bắt buộc để Google luôn trả refresh_token
      scope: ADMOB_SCOPES,
      state,
    });
  }

  /** Xử lý callback OAuth: lưu (các) tài khoản AdMob, trả về danh sách account id vừa kết nối. */
  async handleCallback(code: string, state: string): Promise<string[]> {
    try {
      const payload = await this.jwt.verifyAsync(state);
      if (payload.purpose !== 'admob-oauth') throw new Error();
    } catch {
      throw new BadRequestException('OAuth state không hợp lệ hoặc đã hết hạn');
    }

    const client = this.api.oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google không trả về refresh token, hãy thử kết nối lại');
    }
    client.setCredentials(tokens);

    const accounts = await this.api.listAccounts(client);
    if (!accounts.length) throw new BadRequestException('Tài khoản Google này không có tài khoản AdMob nào');

    const ids: string[] = [];
    for (const acc of accounts) {
      const saved = await this.prisma.admobAccount.upsert({
        where: { publisherId: acc.publisherId },
        create: {
          publisherId: acc.publisherId,
          name: acc.publisherId,
          currencyCode: acc.currencyCode,
          timeZone: acc.reportingTimeZone,
          refreshTokenEnc: encrypt(tokens.refresh_token),
        },
        update: {
          currencyCode: acc.currencyCode,
          timeZone: acc.reportingTimeZone,
          refreshTokenEnc: encrypt(tokens.refresh_token),
        },
      });
      await this.inventory.sync(saved.id, saved.publisherId, client);
      ids.push(saved.id);
    }
    return ids;
  }

  frontendUrl(path: string) {
    return `${this.config.get('FRONTEND_URL', 'http://localhost:5173')}${path}`;
  }
}
