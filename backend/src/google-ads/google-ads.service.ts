import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdmobApiService } from '../admob/admob-api.service';
import { encrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GADS_SCOPES, GoogleAdsApiService } from './google-ads-api.service';

export const GADS_OAUTH_PURPOSE = 'gads-oauth';

/** Kết nối Google Ads bằng OAuth, dùng chung OAuth client và redirect URI với AdMob. */
@Injectable()
export class GoogleAdsService {
  constructor(
    private api: GoogleAdsApiService,
    private oauth: AdmobApiService,
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async authUrl(userId: string): Promise<string> {
    const state = await this.jwt.signAsync({ sub: userId, purpose: GADS_OAUTH_PURPOSE }, { expiresIn: '10m' });
    return this.oauth.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // bắt buộc để Google luôn trả refresh_token
      scope: GADS_SCOPES,
      state,
    });
  }

  /** Lưu mọi tài khoản quảng cáo user truy cập được, trả về id để backfill. */
  async handleCallback(code: string): Promise<string[]> {
    const client = this.oauth.oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException('Google không trả về refresh token, hãy thử kết nối lại');
    }
    client.setCredentials(tokens);

    const accounts = await this.api.accounts(client);
    if (!accounts.length) {
      throw new BadRequestException('Tài khoản Google này không xem được tài khoản Google Ads nào đang hoạt động');
    }
    const refreshTokenEnc = encrypt(tokens.refresh_token);
    for (const a of accounts) {
      const data = {
        loginCustomerId: a.loginCustomerId,
        name: a.name,
        currencyCode: a.currencyCode,
        timeZone: a.timeZone,
        refreshTokenEnc,
        lastError: null,
      };
      await this.prisma.gadsAccount.upsert({ where: { id: a.id }, create: { id: a.id, ...data }, update: data });
    }
    return accounts.map((a) => a.id);
  }
}
