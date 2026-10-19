import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';

export const GADS_SCOPES = ['https://www.googleapis.com/auth/adwords'];

export interface ApiGadsAccount {
  id: string; // customer id 10 chữ số
  loginCustomerId: string;
  name: string;
  currencyCode: string;
  timeZone: string;
}

export interface ApiGadsCampaign {
  id: string;
  name: string;
  storeId: string | null;
}

export interface GadsSpendRow {
  date: string; // YYYY-MM-DD theo múi giờ tài khoản quảng cáo
  campaignId: string;
  campaignName: string;
  country: string;
  spendMicros: bigint;
  impressions: bigint;
  clicks: bigint;
  installs: bigint;
  /** Conversion value theo tiền tệ gốc của tài khoản (micros). */
  convValueMicros: bigint;
}

/**
 * Wrapper mỏng quanh Google Ads API (REST + GAQL). Quyền truy cập (Explorer/Basic) cấp theo project
 * Google Cloud chứa OAuth client, nên không cần developer token.
 */
@Injectable()
export class GoogleAdsApiService {
  constructor(private config: ConfigService) {}

  private base() {
    // Google ngừng hỗ trợ version cũ khoảng 1 năm sau khi ra mắt; khi gặp lỗi version chỉ cần đổi GOOGLE_ADS_API_VERSION.
    return `https://googleads.googleapis.com/${this.config.get('GOOGLE_ADS_API_VERSION', 'v25')}`;
  }

  /** Mọi tài khoản quảng cáo (không phải MCC) user truy cập được, kể cả tài khoản con nằm dưới MCC. */
  async accounts(client: OAuth2Client): Promise<ApiGadsAccount[]> {
    const res = await this.request<{ resourceNames?: string[] }>(client, {
      url: `${this.base()}/customers:listAccessibleCustomers`,
    });
    const roots = (res.resourceNames ?? []).map((r) => r.split('/')[1]);
    const found = new Map<string, ApiGadsAccount>();
    for (const root of roots) {
      // Tài khoản bị huỷ/tạm ngưng trả lỗi PERMISSION_DENIED; bỏ qua để không chặn các tài khoản còn lại.
      const rows = await this.search(client, root, root, `
        SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
               customer_client.time_zone, customer_client.manager
        FROM customer_client
        WHERE customer_client.status = 'ENABLED'`).catch(() => []);
      for (const r of rows) {
        const c = r.customerClient;
        const id = String(c.id);
        if (c.manager || found.has(id)) continue;
        found.set(id, {
          id,
          loginCustomerId: root,
          name: c.descriptiveName || formatCustomerId(id),
          currencyCode: c.currencyCode,
          timeZone: c.timeZone,
        });
      }
    }
    return [...found.values()];
  }

  /** Chiến dịch kèm package name của app (chỉ App campaign / UAC mới có). */
  async campaigns(client: OAuth2Client, customerId: string, loginCustomerId: string): Promise<ApiGadsCampaign[]> {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.name, campaign.app_campaign_setting.app_id
      FROM campaign
      WHERE campaign.status != 'REMOVED'`);
    return rows.map((r) => ({
      id: String(r.campaign.id),
      name: r.campaign.name,
      storeId: r.campaign.appCampaignSetting?.appId ?? null,
    }));
  }

  /**
   * Chi phí theo ngày x chiến dịch x quốc gia.
   *
   * Tổng theo ngày x chiến dịch lấy từ resource campaign (khớp số trên giao diện Google Ads). geographic_view chỉ
   * dùng để chia tổng đó theo quốc gia (vị trí thực của người xem, LOCATION_OF_PRESENCE), vì nó có thể thiếu một
   * phần chi phí của App campaign. Phần chênh lệch, toàn bộ install và conversion value (không lấy được qua
   * geographic_view) ghi vào dòng quốc gia "ZZ" (không rõ), nên tổng theo app/ngày luôn đúng.
   */
  async spend(client: OAuth2Client, customerId: string, loginCustomerId: string, from: string, to: string) {
    const [geoRows, campaignRows] = await Promise.all([
      this.search(client, customerId, loginCustomerId, `
        SELECT segments.date, campaign.id, campaign.name, geographic_view.country_criterion_id,
               metrics.cost_micros, metrics.impressions, metrics.clicks
        FROM geographic_view
        WHERE segments.date BETWEEN '${from}' AND '${to}'
          AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
          AND metrics.cost_micros > 0`),
      this.search(client, customerId, loginCustomerId, `
        SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions,
               metrics.clicks, metrics.biddable_app_install_conversions, metrics.conversions_value
        FROM campaign
        WHERE segments.date BETWEEN '${from}' AND '${to}'`), // GAQL không có OR/ngoặc: dòng toàn 0 bị bỏ ở dưới
    ]);
    const countries = await this.countryCodes(client, customerId, loginCustomerId,
      geoRows.map((r) => String(r.geographicView.countryCriterionId ?? '')));

    const out = geoRows.map<GadsSpendRow>((r) => ({
      date: r.segments.date,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      country: countries.get(String(r.geographicView.countryCriterionId ?? '')) ?? 'ZZ',
      spendMicros: BigInt(r.metrics.costMicros ?? 0),
      impressions: BigInt(r.metrics.impressions ?? 0),
      clicks: BigInt(r.metrics.clicks ?? 0),
      installs: 0n,
      convValueMicros: 0n,
    }));

    // Tổng đã chia theo quốc gia, để tính phần còn thiếu so với tổng của chiến dịch.
    const geoSum = new Map<string, { spend: bigint; impressions: bigint; clicks: bigint }>();
    for (const r of out) {
      const k = `${r.date}|${r.campaignId}`;
      const s = geoSum.get(k) ?? { spend: 0n, impressions: 0n, clicks: 0n };
      s.spend += r.spendMicros;
      s.impressions += r.impressions;
      s.clicks += r.clicks;
      geoSum.set(k, s);
    }
    const positive = (v: bigint) => (v > 0n ? v : 0n);
    for (const r of campaignRows) {
      const g = geoSum.get(`${r.segments.date}|${r.campaign.id}`) ?? { spend: 0n, impressions: 0n, clicks: 0n };
      const row: GadsSpendRow = {
        date: r.segments.date,
        campaignId: String(r.campaign.id),
        campaignName: r.campaign.name,
        country: 'ZZ',
        spendMicros: positive(BigInt(r.metrics.costMicros ?? 0) - g.spend),
        impressions: positive(BigInt(r.metrics.impressions ?? 0) - g.impressions),
        clicks: positive(BigInt(r.metrics.clicks ?? 0) - g.clicks),
        installs: BigInt(Math.round(Number(r.metrics.biddableAppInstallConversions ?? 0))),
        // conversions_value là số thực theo tiền tệ tài khoản (không phải micros).
        convValueMicros: BigInt(Math.round(Number(r.metrics.conversionsValue ?? 0) * 1e6)),
      };
      if (row.spendMicros || row.impressions || row.clicks || row.installs || row.convValueMicros) out.push(row);
    }
    return out;
  }

  /**
   * Conversion value theo ngày tương tác quảng cáo x chiến dịch x độ trễ chuyển đổi, để tính ROAS D0/D3/D7…
   * (giá trị phát sinh trong vòng N ngày kể từ lúc tương tác). Bỏ dòng có giá trị 0.
   */
  async conversionLag(client: OAuth2Client, customerId: string, loginCustomerId: string, from: string, to: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT segments.date, campaign.id, segments.conversion_lag_bucket, metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${from}' AND '${to}'
        AND metrics.conversions_value > 0`);
    return rows.map((r) => ({
      date: r.segments.date as string,
      campaignId: String(r.campaign.id),
      lagBucket: String(r.segments.conversionLagBucket ?? 'UNKNOWN'),
      // conversions_value là số thực theo tiền tệ tài khoản (không phải micros).
      valueMicros: BigInt(Math.round(Number(r.metrics.conversionsValue ?? 0) * 1e6)),
    }));
  }

  /** geographic_view trả id tiêu chí địa lý (2704 = VN); đổi sang mã ISO 2 ký tự giống AdMob/Facebook. */
  private async countryCodes(client: OAuth2Client, customerId: string, loginCustomerId: string, ids: string[]) {
    const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
    const out = new Map<string, string>();
    if (!unique.length) return out;
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT geo_target_constant.id, geo_target_constant.country_code
      FROM geo_target_constant
      WHERE geo_target_constant.id IN (${unique.join(',')})`);
    for (const r of rows) out.set(String(r.geoTargetConstant.id), r.geoTargetConstant.countryCode ?? 'ZZ');
    return out;
  }

  private async search(client: OAuth2Client, customerId: string, loginCustomerId: string, query: string): Promise<any[]> {
    const res = await this.request<Array<{ results?: any[] }>>(client, {
      url: `${this.base()}/customers/${customerId}/googleAds:searchStream`,
      method: 'POST',
      headers: { 'login-customer-id': loginCustomerId },
      data: { query },
    });
    return (Array.isArray(res) ? res : [res]).flatMap((b) => b.results ?? []);
  }

  private async request<T>(client: OAuth2Client, opts: Parameters<OAuth2Client['request']>[0], attempt = 1): Promise<T> {
    try {
      return (await client.request<T>(opts)).data;
    } catch (e: any) {
      // Lỗi mạng tạm thời (timeout, mất kết nối) hoặc Google quá tải: đợi rồi thử lại, tối đa 4 lần.
      const status = e?.response?.status;
      const transient = !status || status === 429 || status >= 500;
      if (transient && attempt < 4) {
        await new Promise((r) => setTimeout(r, 3000 * attempt));
        return this.request<T>(client, opts, attempt + 1);
      }
      throw new Error(`Google Ads API: ${errorMessage(e)}`);
    }
  }
}

/** Lỗi Google Ads nằm sâu trong details[].errors[]; lấy câu dễ đọc nhất. */
function errorMessage(e: any): string {
  const data = e?.response?.data;
  const err = Array.isArray(data) ? data[0]?.error : data?.error;
  return err?.details?.[0]?.errors?.[0]?.message ?? err?.message ?? e?.message ?? String(e);
}

/** 1234567890 -> 123-456-7890, giống cách Google Ads hiển thị. */
export function formatCustomerId(id: string) {
  return id.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3');
}
