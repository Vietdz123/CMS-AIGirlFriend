import { BadRequestException, Body, Controller, Delete, Get, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsNumber, IsPositive, IsString, Matches } from 'class-validator';
import { Roles } from '../auth/decorators';
import { isIsoDate } from './dates';
import { FxService } from './fx.service';

class SetRateDto {
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;

  /** Số đơn vị tiền tệ cho 1 USD (ví dụ 25.850 VND). */
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  rate: number;
}

/** Tỷ giá quy đổi chi phí quảng cáo sang USD: ai cũng xem được, chỉ admin sửa. */
@Controller('fx')
export class FxController {
  constructor(private fx: FxService) {}

  @Get('currencies')
  currencies() {
    return this.fx.currencies();
  }

  /** Query: currency, from, to. */
  @Get('rates')
  rates(@Query() q: Record<string, string | undefined>) {
    if (!q.currency || !isIsoDate(q.from) || !isIsoDate(q.to) || q.from > q.to) {
      throw new BadRequestException('Cần currency, from/to dạng YYYY-MM-DD và from <= to');
    }
    return this.fx.list(q.currency, q.from, q.to);
  }

  @Roles(Role.ADMIN)
  @Put('rates')
  async set(@Body() dto: SetRateDto) {
    if (dto.from > dto.to) throw new BadRequestException('from phải <= to');
    if (dto.currency.toUpperCase() === 'USD') throw new BadRequestException('USD luôn là 1');
    await this.fx.setManual(dto.currency, dto.from, dto.to, dto.rate);
    return { ok: true };
  }

  /** Bỏ sửa tay 1 ngày, quay về tỷ giá thị trường. Query: currency, date. */
  @Roles(Role.ADMIN)
  @Delete('rates')
  async reset(@Query() q: Record<string, string | undefined>) {
    if (!q.currency || !isIsoDate(q.date)) throw new BadRequestException('Cần currency và date dạng YYYY-MM-DD');
    await this.fx.reset(q.currency, q.date).catch((e: Error) => {
      throw new BadRequestException(e.message);
    });
    return { ok: true };
  }
}
