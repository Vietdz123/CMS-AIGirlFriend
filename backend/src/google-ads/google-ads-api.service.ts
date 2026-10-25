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
   * phần của App campaign. Install theo nước = chuyển đổi dùng để đặt giá thầu loại DOWNLOAD (geographic_view không
   * hỗ trợ biddable_app_install_conversions). Phần chênh lệch so với tổng chiến dịch ghi vào quốc gia "ZZ" (không
   * rõ), nên tổng theo app/ngày luôn đúng.
   */
  async spend(client: OAuth2Client, customerId: string, loginCustomerId: string, from: string, to: string) {
    const [geoRows, campaignRows, geoConvRows] = await Promise.all([
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
      this.search(client, customerId, loginCustomerId, `
        SELECT segments.date, campaign.id, campaign.name, geographic_view.country_criterion_id,
               segments.conversion_action_category, metrics.conversions, metrics.conversions_value
        FROM geographic_view
        WHERE segments.date BETWEEN '${from}' AND '${to}'
          AND geographic_view.location_type = 'LOCATION_OF_PRESENCE'
          AND metrics.all_conversions > 0`),
    ]);
    const countries = await this.countryCodes(client, customerId, loginCustomerId,
      [...geoRows, ...geoConvRows].map((r) => String(r.geographicView.countryCriterionId ?? '')));
    const countryOf = (r: any) => countries.get(String(r.geographicView.countryCriterionId ?? '')) ?? 'ZZ';

    // 1 dòng / ngày x chiến dịch x quốc gia: chi phí từ geoRows, install + conversion value từ geoConvRows.
    const rows = new Map<string, GadsSpendRow>();
    const rowFor = (r: any) => {
      const key = `${r.segments.date}|${r.campaign.id}|${countryOf(r)}`;
      let row = rows.get(key);
      if (!row) {
        row = {
          date: r.segments.date, campaignId: String(r.campaign.id), campaignName: r.campaign.name, country: countryOf(r),
          spendMicros: 0n, impressions: 0n, clicks: 0n, installs: 0n, convValueMicros: 0n,
        };
        rows.set(key, row);
      }
      return row;
    };
    for (const r of geoRows) {
      const row = rowFor(r);
      row.spendMicros += BigInt(r.metrics.costMicros ?? 0);
      row.impressions += BigInt(r.metrics.impressions ?? 0);
      row.clicks += BigInt(r.metrics.clicks ?? 0);
    }
    // Install là số thực (Google chia chuyển đổi theo mô hình phân bổ); cộng dồn trước rồi mới làm tròn.
    const geoInstalls = new Map<string, number>();
    for (const r of geoConvRows) {
      const row = rowFor(r);
      // conversions_value là số thực theo tiền tệ tài khoản (không phải micros).
      row.convValueMicros += BigInt(Math.round(Number(r.metrics.conversionsValue ?? 0) * 1e6));
      if (r.segments.conversionActionCategory === 'DOWNLOAD') {
        const key = `${row.date}|${row.campaignId}|${row.country}`;
        geoInstalls.set(key, (geoInstalls.get(key) ?? 0) + Number(r.metrics.conversions ?? 0));
      }
    }
    for (const [key, n] of geoInstalls) rows.get(key)!.installs = BigInt(Math.round(n));
    const out = [...rows.values()];

    // Tổng đã chia theo quốc gia, để tính phần còn thiếu so với tổng của chiến dịch.
    const zero = () => ({ spend: 0n, impressions: 0n, clicks: 0n, installs: 0n, conv: 0n });
    const geoSum = new Map<string, ReturnType<typeof zero>>();
    for (const r of out) {
      const k = `${r.date}|${r.campaignId}`;
      const s = geoSum.get(k) ?? zero();
      s.spend += r.spendMicros;
      s.impressions += r.impressions;
      s.clicks += r.clicks;
      s.installs += r.installs;
      s.conv += r.convValueMicros;
      geoSum.set(k, s);
    }
    const positive = (v: bigint) => (v > 0n ? v : 0n);
    for (const r of campaignRows) {
      const g = geoSum.get(`${r.segments.date}|${r.campaign.id}`) ?? zero();
      const row: GadsSpendRow = {
        date: r.segments.date,
        campaignId: String(r.campaign.id),
        campaignName: r.campaign.name,
        country: 'ZZ',
        spendMicros: positive(BigInt(r.metrics.costMicros ?? 0) - g.spend),
        impressions: positive(BigInt(r.metrics.impressions ?? 0) - g.impressions),
        clicks: positive(BigInt(r.metrics.clicks ?? 0) - g.clicks),
        installs: positive(BigInt(Math.round(Number(r.metrics.biddableAppInstallConversions ?? 0))) - g.installs),
        convValueMicros: positive(BigInt(Math.round(Number(r.metrics.conversionsValue ?? 0) * 1e6)) - g.conv),
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

  /**
   * Account budget đang hiệu lực (tài khoản nạp tiền / hạn mức): hạn mức, đã tiêu, tổng điều chỉnh, tiền gốc (micros).
   * null khi tài khoản không có account budget (ví dụ thanh toán tự động không hạn mức).
   */
  async accountBalance(client: OAuth2Client, customerId: string, loginCustomerId: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT account_budget.status, account_budget.approved_spending_limit_micros,
             account_budget.approved_spending_limit_type, account_budget.amount_served_micros,
             account_budget.total_adjustments_micros
      FROM account_budget
      WHERE account_budget.status = 'APPROVED'`);
    if (!rows.length) return null;
    // Có thể có nhiều account budget nối tiếp nhau; cộng lại thành số dư của cả tài khoản.
    let limit = 0n;
    let served = 0n;
    let adjustment = 0n;
    for (const r of rows) {
      const b = r.accountBudget;
      limit += BigInt(b.approvedSpendingLimitMicros ?? 0);
      served += BigInt(b.amountServedMicros ?? 0);
      adjustment += BigInt(b.totalAdjustmentsMicros ?? 0);
    }
    return { limitMicros: limit, servedMicros: served, adjustmentMicros: adjustment };
  }

  /** Click và click không hợp lệ (Google đã lọc, không tính tiền) theo ngày của cả tài khoản. */
  async invalidClicks(client: OAuth2Client, customerId: string, loginCustomerId: string, from: string, to: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT segments.date, metrics.clicks, metrics.invalid_clicks
      FROM customer
      WHERE segments.date BETWEEN '${from}' AND '${to}'`);
    return rows.map((r) => ({
      date: r.segments.date as string,
      clicks: Number(r.metrics.clicks ?? 0),
      invalidClicks: Number(r.metrics.invalidClicks ?? 0),
    }));
  }

  /** Chi phí, installs, conversion value theo giờ hôm nay (múi giờ tài khoản) của từng chiến dịch, tiền gốc (micros). */
  async hourlyToday(client: OAuth2Client, customerId: string, loginCustomerId: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.name, segments.hour, metrics.cost_micros, metrics.conversions_value
      FROM campaign
      WHERE segments.date DURING TODAY AND metrics.impressions > 0`);
    return rows.map((r) => ({
      campaignId: String(r.campaign.id),
      campaignName: String(r.campaign.name),
      hour: Number(r.segments.hour ?? 0),
      costMicros: BigInt(r.metrics.costMicros ?? 0),
      // conversions_value là số thực theo tiền tệ tài khoản (không phải micros).
      valueMicros: BigInt(Math.round(Number(r.metrics.conversionsValue ?? 0) * 1e6)),
    }));
  }

  /** Budget/ngày hiện tại của từng chiến dịch (chỉ budget kiểu DAILY), tiền gốc của tài khoản (micros). */
  async campaignBudgets(client: OAuth2Client, customerId: string, loginCustomerId: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT campaign.id, campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.period
      FROM campaign
      WHERE campaign.status != 'REMOVED'`);
    return rows
      .filter((r) => r.campaignBudget?.period === 'DAILY' && r.campaignBudget?.amountMicros)
      .map((r) => ({
        campaignId: String(r.campaign.id),
        budgetResource: String(r.campaign.campaignBudget),
        micros: BigInt(r.campaignBudget.amountMicros),
      }));
  }

  /**
   * Các lần đổi budget trong `days` ngày gần nhất (Google chỉ giữ lịch sử thay đổi khoảng 30 ngày).
   * Trả về theo budget resource; changeDateTime theo múi giờ của tài khoản.
   */
  async budgetChanges(client: OAuth2Client, customerId: string, loginCustomerId: string, from: string, to: string) {
    const rows = await this.search(client, customerId, loginCustomerId, `
      SELECT change_event.change_date_time, change_event.change_resource_name,
             change_event.resource_change_operation, change_event.old_resource, change_event.new_resource
      FROM change_event
      WHERE change_event.change_date_time >= '${from}' AND change_event.change_date_time <= '${to} 23:59:59'
        AND change_event.change_resource_type IN ('CAMPAIGN_BUDGET')
      ORDER BY change_event.change_date_time DESC
      LIMIT 10000`);
    return rows
      .map((r) => {
        const e = r.changeEvent;
        const oldAmount = e.oldResource?.campaignBudget?.amountMicros;
        const newAmount = e.newResource?.campaignBudget?.amountMicros;
        if (!newAmount) return null; // đổi thứ khác ngoài số tiền
        return {
          budgetResource: String(e.changeResourceName),
          at: String(e.changeDateTime),
          date: String(e.changeDateTime).slice(0, 10),
          oldMicros: e.resourceChangeOperation === 'CREATE' || !oldAmount ? null : BigInt(oldAmount),
          newMicros: BigInt(newAmount),
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
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
