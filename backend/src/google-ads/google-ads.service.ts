import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdmobApiService } from '../admob/admob-api.service';
import { encrypt } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GADS_SCOPES, GoogleAdsApiService } from './google-ads-api.service';

export const GADS_OAUTH_PURPOSE = 'gads-oauth';
/** Link mời người ngoài (không có tài khoản CMS) tự đăng nhập Google để nối tài khoản Google Ads của họ. */
const GADS_INVITE_PURPOSE = 'gads-invite';
/** Link mời dùng được trong chừng ấy ngày. */
export const GADS_INVITE_DAYS = 7;

/** Kết nối Google Ads bằng OAuth, dùng chung OAuth client và redirect URI với AdMob. */
@Injectable()
export class GoogleAdsService {
  constructor(
    private api: GoogleAdsApiService,
    private oauth: AdmobApiService,
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
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

  /** Tạo link mời: trang công khai trên CMS để người khác tự đăng nhập Google và nối tài khoản Google Ads. */
  async inviteLink(userId: string) {
    const token = await this.jwt.signAsync(
      { sub: userId, purpose: GADS_INVITE_PURPOSE },
      { expiresIn: `${GADS_INVITE_DAYS}d` },
    );
    const base = this.config.get('FRONTEND_URL', 'http://localhost:5173');
    return {
      url: `${base}/connect/google-ads?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + GADS_INVITE_DAYS * 86_400_000).toISOString(),
    };
  }

  /** Từ link mời còn hạn: link đăng nhập Google; state đánh dấu invite để callback đưa người dùng về trang cảm ơn. */
  async inviteAuthUrl(token: string): Promise<string> {
    let inviter: string;
    try {
      const payload = await this.jwt.verifyAsync(token);
      if (payload.purpose !== GADS_INVITE_PURPOSE) throw new Error();
      inviter = payload.sub;
    } catch {
      throw new BadRequestException('Link mời không hợp lệ hoặc đã hết hạn, hãy xin link mới');
    }
    const state = await this.jwt.signAsync(
      { sub: inviter, purpose: GADS_OAUTH_PURPOSE, invite: true },
      { expiresIn: '30m' },
    );
    return this.oauth.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
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
