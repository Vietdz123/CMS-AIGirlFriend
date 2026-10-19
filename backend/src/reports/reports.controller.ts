import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AppAccessService } from '../auth/app-access.service';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { isIsoDate } from '../common/dates';
import { EXPLORE_DIMENSIONS, ExploreDimension, ExploreService } from './explore.service';
import { Dimension, Granularity, ReportFilter, ReportsService } from './reports.service';

const DIMENSIONS: Dimension[] = ['app', 'adUnit', 'format', 'country', 'adSource', 'account'];
const GRANULARITIES: Granularity[] = ['day', 'week', 'month'];

/** Query: from, to (YYYY-MM-DD), appIds, accountIds, formats, countries (phân tách bằng dấu phẩy). */
type FilterQuery = Record<string, string | undefined>;

@Controller('reports')
export class ReportsController {
  constructor(
    private reports: ReportsService,
    private access: AppAccessService,
    private explore: ExploreService,
  ) {}

  /**
   * Bảng phân tích tuỳ chọn chiều (giống báo cáo AdMob), lấy trực tiếp từ AdMob API.
   * Query: from, to, dimensions (date,account,app,adUnit,format,adSource,country,appVersion),
   * appIds, adUnitIds, adSourceIds, appVersions, countries, formats (phân tách bằng dấu phẩy).
   */
  @Get('explore')
  async exploreReport(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    const base = await this.filter(user, q);
    const dimensions = (list(q.dimensions) ?? []) as ExploreDimension[];
    if (dimensions.some((d) => !(d in EXPLORE_DIMENSIONS))) throw new BadRequestException('dimension không hợp lệ');
    return this.explore.run({
      from: base.from,
      to: base.to,
      appIds: base.appIds,
      dimensions,
      adUnitIds: list(q.adUnitIds),
      adSourceIds: list(q.adSourceIds),
      appVersions: list(q.appVersions),
      countries: base.countries,
      formats: base.formats,
    });
  }

  @Get('explore/options')
  async exploreOptions(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    const base = await this.filter(user, q);
    return this.explore.options({ from: base.from, to: base.to, appIds: base.appIds });
  }

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    return this.reports.summary(await this.filter(user, q));
  }

  @Get('timeseries')
  async timeseries(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    const granularity = (q.granularity ?? 'day') as Granularity;
    if (!GRANULARITIES.includes(granularity)) throw new BadRequestException('granularity không hợp lệ');
    return this.reports.timeseries(await this.filter(user, q), granularity);
  }

  @Get('breakdown')
  async breakdown(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    const dimension = q.dimension as Dimension;
    if (!DIMENSIONS.includes(dimension)) throw new BadRequestException('dimension không hợp lệ');
    const limit = Math.min(Number(q.limit) || 100, 500);
    return this.reports.breakdown(await this.filter(user, q), dimension, limit);
  }

  @Get('app-daily')
  async appDaily(@CurrentUser() user: AuthUser, @Query() q: FilterQuery) {
    return this.reports.appDaily(await this.filter(user, q));
  }

  @Get('filters')
  async filters(@CurrentUser() user: AuthUser) {
    return this.reports.filterOptions(await this.access.allowedAppIds(user));
  }

  private async filter(user: AuthUser, q: FilterQuery): Promise<ReportFilter> {
    if (!isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('from/to phải có dạng YYYY-MM-DD và from <= to');
    }
    return {
      from: q.from,
      to: q.to,
      appIds: await this.access.resolveAppIds(user, list(q.appIds)),
      accountIds: list(q.accountIds),
      formats: list(q.formats),
      countries: list(q.countries),
    };
  }
}

function list(v?: string): string[] | undefined {
  const items = v?.split(',').map((s) => s.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}
