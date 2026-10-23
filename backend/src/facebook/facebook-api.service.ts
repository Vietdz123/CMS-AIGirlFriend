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

  /**
   * Budget/ngày hiện tại theo chiến dịch (tiền gốc, micros). Budget đặt ở chiến dịch (CBO) lấy thẳng; budget đặt ở
   * ad set thì cộng daily_budget của các ad set đang chạy. Facebook trả số tiền theo đơn vị nhỏ nhất (cent).
   */
  async campaignBudgets(token: string, accountId: string, currency: string) {
    const [campaigns, adSets] = await Promise.all([
      this.listAll<{ id: string; daily_budget?: string }>(token, `${accountId}/campaigns`, { fields: 'id,daily_budget' }),
      this.listAll<{ campaign_id: string; daily_budget?: string; effective_status?: string }>(
        token, `${accountId}/adsets`, { fields: 'campaign_id,daily_budget,effective_status' }),
    ]);
    const factor = 1e6 / minorUnit(currency);
    const out = new Map<string, bigint>();
    for (const c of campaigns) if (Number(c.daily_budget) > 0) out.set(c.id, BigInt(Math.round(Number(c.daily_budget) * factor)));
    for (const s of adSets) {
      if (out.has(s.campaign_id) || !(Number(s.daily_budget) > 0) || s.effective_status !== 'ACTIVE') continue;
      out.set(`adset:${s.campaign_id}`, (out.get(`adset:${s.campaign_id}`) ?? 0n) + BigInt(Math.round(Number(s.daily_budget) * factor)));
    }
    for (const [k, v] of [...out]) {
      if (!k.startsWith('adset:')) continue;
      out.delete(k);
      if (!out.has(k.slice(6))) out.set(k.slice(6), v);
    }
    return out;
  }

  /**
   * Các lần đổi budget/ngày của chiến dịch (CBO) từ nhật ký hoạt động. Thời điểm trả về là UTC; ngày được quy về
   * múi giờ tài khoản. Chỉ lấy loại "Per day"; lifetime budget bị bỏ qua.
   */
  async budgetChanges(token: string, accountId: string, from: string, timeZone: string) {
    const rows = await this.listAll<{ event_type: string; event_time: string; object_id: string; extra_data?: string }>(
      token, `${accountId}/activities`,
      { fields: 'event_type,event_time,object_id,extra_data', since: String(Math.floor(Date.parse(`${from}T00:00:00Z`) / 1000) - 86400) },
    );
    const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone });
    return rows
      .filter((r) => r.event_type === 'update_campaign_budget' && r.extra_data)
      .map((r) => {
        let data: any;
        try { data = JSON.parse(r.extra_data!); } catch { return null; }
        const oldV = data?.old_value;
        const newV = data?.new_value;
        if (newV?.additional_value !== 'Per day' || typeof newV?.new_value !== 'number') return null;
        const currency = String(newV.currency ?? 'USD');
        const toMicros = (v: number) => BigInt(Math.round(v * 1e6 / minorUnit(currency)));
        return {
          campaignId: r.object_id,
          at: r.event_time,
          date: dateFmt.format(new Date(r.event_time)),
          oldMicros: oldV?.additional_value === 'Per day' && typeof oldV?.old_value === 'number' ? toMicros(oldV.old_value) : null,
          newMicros: toMicros(newV.new_value),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
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

/** Số đơn vị nhỏ nhất trong 1 đơn vị tiền (USD = 100 cent; VND, JPY… = 1), dùng cho số tiền Facebook trả về. */
function minorUnit(currency: string) {
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return 10 ** digits;
}
