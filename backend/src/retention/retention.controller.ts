import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { isIsoDate } from '../common/dates';
import { CompareDimension, MAX_DAY, RetentionService } from './retention.service';

type Q = Record<string, string | undefined>;
const list = (v?: string) => v?.split(',').map((s) => s.trim()).filter(Boolean);
const COMPARE_DIMENSIONS: CompareDimension[] = ['country', 'source', 'version'];

/** Retention từ GA4: số liệu của cả app (GA4 không chia theo app AdMob), nên mọi user đăng nhập đều xem được. */
@Controller('retention')
export class RetentionController {
  constructor(private retention: RetentionService) {}

  @Get('status')
  status() {
    return {
      enabled: this.retention.enabled,
      running: this.retention.isRunning(),
      lastSyncedAt: this.retention.lastSyncedAt,
      lastError: this.retention.lastError,
      maxDay: MAX_DAY,
    };
  }

  @Roles(Role.ADMIN, Role.MANAGER)
  @Post('sync')
  sync() {
    return { started: this.retention.start() };
  }

  /** Query: from, to (ngày cài), countries, sources, versions (phân tách bằng dấu phẩy). */
  @Get('by-date')
  byDate(@Query() q: Q) {
    return this.retention.byDate({ ...range(q.from, q.to), ...this.segments(q) });
  }

  @Get('by-country')
  byCountry(@Query() q: Q) {
    return this.retention.byCountry({ ...range(q.from, q.to), ...this.segments(q) });
  }

  /** So sánh 2 khoảng ngày cài. Query: aFrom, aTo, bFrom, bTo, day (1..60), by (country|source|version) + bộ lọc. */
  @Get('compare')
  compare(@Query() q: Q) {
    const day = Number(q.day);
    if (!Number.isInteger(day) || day < 1 || day > MAX_DAY) throw new BadRequestException(`day phải từ 1 tới ${MAX_DAY}`);
    const by = q.by as CompareDimension;
    if (!COMPARE_DIMENSIONS.includes(by)) throw new BadRequestException('by phải là country, source hoặc version');
    return this.retention.compare({ a: range(q.aFrom, q.aTo), b: range(q.bFrom, q.bTo), day, by, ...this.segments(q) });
  }

  /** Doanh thu quảng cáo theo ngày phát sinh x ngày cài. Query: from, to (ngày phát sinh doanh thu). */
  @Get('revenue-by-install')
  revenueByInstall(@Query() q: Q) {
    return this.retention.revenueByInstallDate(range(q.from, q.to));
  }

  @Get('sources')
  sources() {
    return this.retention.sources();
  }

  @Get('versions')
  versions() {
    return this.retention.versions();
  }

  private segments(q: Q) {
    return { countries: list(q.countries), sources: list(q.sources), versions: list(q.versions) };
  }
}

function range(from?: string, to?: string) {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
    throw new BadRequestException('Ngày phải có dạng YYYY-MM-DD và ngày đầu <= ngày cuối');
  }
  return { from, to };
}
