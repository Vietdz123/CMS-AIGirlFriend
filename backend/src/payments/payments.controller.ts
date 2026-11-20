import {
  BadRequestException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, Req, Res, UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PaymentDirection, Prisma, Role } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { isIsoDate, toDbDate } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';

/** Ảnh hoá đơn tối đa 8 MB, chỉ nhận định dạng ảnh. */
const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'];
const DIRECTIONS: PaymentDirection[] = ['IN', 'OUT'];

type Body = Record<string, string | undefined>;
/**
 * Trường của form multipart lấy thẳng từ req.body: @Body() đi qua ValidationPipe (whitelist) nên một object không có DTO
 * bị xoá hết trường.
 */
const fields = (req: Request): Body => (req.body ?? {}) as Body;
type UploadedImage = { buffer: Buffer; mimetype: string; originalname: string; size: number };

/** Payments: khoản nhận / chi nhập tay kèm ảnh hoá đơn. Admin và manager xem, thêm, sửa; chỉ admin xoá. */
@Roles(Role.ADMIN, Role.MANAGER)
@Controller('payments')
export class PaymentsController {
  constructor(private prisma: PrismaService) {}

  /** Query: from, to (YYYY-MM-DD, tuỳ chọn), direction (IN | OUT), q (tìm theo người / ghi chú). */
  @Get()
  async list(@Query() q: Record<string, string | undefined>) {
    if ((q.from && !isIsoDate(q.from)) || (q.to && !isIsoDate(q.to))) throw new BadRequestException('from/to phải có dạng YYYY-MM-DD');
    const where: Prisma.PaymentWhereInput = {
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
      ...(q.direction && DIRECTIONS.includes(q.direction as PaymentDirection) ? { direction: q.direction as PaymentDirection } : {}),
      ...(q.q?.trim() ? { OR: [{ party: { contains: q.q.trim(), mode: 'insensitive' } }, { note: { contains: q.q.trim(), mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.payment.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      // Không trả ảnh trong danh sách; ảnh lấy riêng qua /payments/:id/receipt.
      select: { id: true, direction: true, date: true, party: true, amount: true, currency: true, note: true, receiptName: true, receiptType: true, createdAt: true },
    });
    return rows.map(({ receiptType, ...r }) => ({
      ...r, date: r.date.toISOString().slice(0, 10), amount: Number(r.amount), hasReceipt: !!receiptType,
    }));
  }

  @Post()
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async create(@CurrentUser() user: AuthUser, @Req() req: Request, @UploadedFile() file?: UploadedImage) {
    const data = parse(fields(req));
    const created = await this.prisma.payment.create({ data: { ...data, ...receipt(file), createdById: user.id }, select: { id: true } });
    return created;
  }

  /** Sửa khoản tiền. Gửi file mới để thay ảnh; removeReceipt = "1" để xoá ảnh. */
  @Patch(':id')
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: MAX_RECEIPT_BYTES } }))
  async update(@Param('id') id: string, @Req() req: Request, @UploadedFile() file?: UploadedImage) {
    const body = fields(req);
    await this.exists(id);
    const clear = body.removeReceipt === '1' ? { receipt: null, receiptType: null, receiptName: null } : {};
    await this.prisma.payment.update({ where: { id }, data: { ...parse(body), ...clear, ...receipt(file) } });
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.exists(id);
    await this.prisma.payment.delete({ where: { id } });
    return { ok: true };
  }

  /** Ảnh hoá đơn (gọi kèm Authorization như mọi API). */
  @Get(':id/receipt')
  async receipt(@Param('id') id: string, @Res() res: Response) {
    const p = await this.prisma.payment.findUnique({ where: { id }, select: { receipt: true, receiptType: true, receiptName: true } });
    if (!p?.receipt || !p.receiptType) throw new NotFoundException('Không có hoá đơn');
    res.setHeader('Content-Type', p.receiptType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(p.receiptName ?? 'hoa-don')}`);
    res.send(Buffer.from(p.receipt));
  }

  private async exists(id: string) {
    if (!(await this.prisma.payment.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Không tìm thấy khoản tiền');
  }
}

/** Đọc các trường của form (multipart nên mọi giá trị là chuỗi). */
function parse(b: Body) {
  const direction = b.direction as PaymentDirection;
  if (!DIRECTIONS.includes(direction)) throw new BadRequestException('Chọn khoản nhận hoặc khoản chi');
  if (!isIsoDate(b.date)) throw new BadRequestException('Ngày phải có dạng YYYY-MM-DD');
  const party = b.party?.trim();
  if (!party) throw new BadRequestException('Nhập người thanh toán / người nhận');
  const amount = Number(String(b.amount ?? '').replace(/[\s,]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Khoản tiền phải là số lớn hơn 0');
  const currency = (b.currency || 'VND').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Tiền tệ không hợp lệ');
  return { direction, date: toDbDate(b.date), party: party.slice(0, 200), amount: new Prisma.Decimal(amount.toFixed(2)), currency, note: b.note?.trim().slice(0, 1000) || null };
}

function receipt(file?: UploadedImage) {
  if (!file) return {};
  if (!RECEIPT_TYPES.includes(file.mimetype)) throw new BadRequestException('Hoá đơn phải là ảnh (JPG, PNG, WEBP, HEIC)');
  return { receipt: new Uint8Array(file.buffer), receiptType: file.mimetype, receiptName: file.originalname.slice(0, 200) };
}
