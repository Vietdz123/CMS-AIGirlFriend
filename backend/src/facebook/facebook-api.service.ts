import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ApiAdAccount {
  id: string; // act_XXXXXXXX
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
}

export interface ApiCampaign {
  id: string;
  name: string;
  storeId: string | null;
}

export interface InsightRow {
  date: string; // YYYY-MM-DD theo múi giờ tài khoản quảng cáo
  campaignId: string;
  campaignName: string;
  country: string;
  spendMicros: bigint;
  impressions: bigint;
  clicks: bigint;
  installs: bigint;
}

interface PromotedObject {
  object_store_url?: string;
}

/** Wrapper mỏng quanh Meta Marketing API (Graph API). Token là token System User có quyền ads_read. */
@Injectable()
export class FacebookApiService {
  constructor(private config: ConfigService) {}

  private base() {
    // Meta ngừng hỗ trợ version cũ định kỳ; khi gặp lỗi #2635 chỉ cần đổi FB_API_VERSION.
    return `https://graph.facebook.com/${this.config.get('FB_API_VERSION', 'v26.0')}`;
  }

  adAccounts(token: string): Promise<ApiAdAccount[]> {
    return this.listAll(token, 'me/adaccounts', { fields: 'account_id,name,currency,timezone_name' });
  }

  /** Chiến dịch kèm package name của app được quảng cáo (nằm ở campaign hoặc ad set tuỳ loại chiến dịch). */
  async campaigns(token: string, accountId: string): Promise<ApiCampaign[]> {
    const [campaigns, adSets] = await Promise.all([
      this.listAll<{ id: string; name: string; promoted_object?: PromotedObject }>(
        token, `${accountId}/campaigns`, { fields: 'id,name,promoted_object' }),
      this.listAll<{ campaign_id: string; promoted_object?: PromotedObject }>(
        token, `${accountId}/adsets`, { fields: 'campaign_id,promoted_object' }),
    ]);
    const fromAdSets = new Map<string, string>();
    for (const s of adSets) {
      const storeId = parseStoreId(s.promoted_object?.object_store_url);
      if (storeId && !fromAdSets.has(s.campaign_id)) fromAdSets.set(s.campaign_id, storeId);
    }
    return campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      storeId: parseStoreId(c.promoted_object?.object_store_url) ?? fromAdSets.get(c.id) ?? null,
    }));
  }

  /** Insights theo ngày x chiến dịch x quốc gia. */
  async insights(token: string, accountId: string, from: string, to: string): Promise<InsightRow[]> {
    const rows = await this.listAll<{
      date_start: string;
      campaign_id: string;
      campaign_name: string;
      country?: string;
      spend?: string;
      impressions?: string;
      clicks?: string;
      actions?: { action_type: string; value: string }[];
    }>(token, `${accountId}/insights`, {
      level: 'campaign',
      time_increment: '1',
      breakdowns: 'country',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions',
      time_range: JSON.stringify({ since: from, until: to }),
    });
    return rows.map((r) => {
      const install =
        r.actions?.find((a) => a.action_type === 'mobile_app_install') ??
        r.actions?.find((a) => a.action_type === 'app_install');
      return {
        date: r.date_start,
        campaignId: r.campaign_id,
        campaignName: r.campaign_name,
        country: r.country ?? 'ZZ',
        spendMicros: BigInt(Math.round(Number(r.spend ?? 0) * 1e6)),
        impressions: BigInt(r.impressions ?? 0),
        clicks: BigInt(r.clicks ?? 0),
        installs: BigInt(Math.round(Number(install?.value ?? 0))),
      };
    });
  }

  private async listAll<T>(token: string, path: string, params: Record<string, string>): Promise<T[]> {
    const url = new URL(`${this.base()}/${path}`);
    for (const [k, v] of Object.entries({ ...params, limit: '500', access_token: token })) url.searchParams.set(k, v);
    const out: T[] = [];
    let next: string | undefined = url.toString();
    while (next) {
      const res = await fetch(next);
      const body = (await res.json().catch(() => ({}))) as {
        data?: T[];
        paging?: { next?: string };
        error?: { message?: string };
      };
      // Không đưa URL vào lỗi vì URL chứa access_token.
      if (!res.ok || body.error) throw new Error(`Facebook API: ${body.error?.message ?? res.statusText}`);
      out.push(...(body.data ?? []));
      next = body.paging?.next;
    }
    return out;
  }
}

/** Google Play: ...details?id=com.example.app → com.example.app; App Store: .../id123456 → 123456 (giống App.storeId của AdMob). */
function parseStoreId(url?: string): string | null {
  if (!url) return null;
  return url.match(/[?&]id=([\w.]+)/)?.[1] ?? url.match(/\/id(\d+)/)?.[1] ?? null;
}
