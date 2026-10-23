import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

// Prisma trả BigInt cho các cột metric; JSON.stringify không hỗ trợ BigInt mặc định.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Production: phục vụ luôn frontend đã build (PUBLIC_DIR) từ cùng 1 server.
  const publicDir = process.env.PUBLIC_DIR;
  if (publicDir && existsSync(publicDir)) {
    // File trong assets/ có hash trong tên nên cache lâu được; index.html luôn phải lấy bản mới, nếu không trình duyệt
    // giữ giao diện cũ (gọi API mới bằng code cũ) sau mỗi lần cập nhật.
    app.useStaticAssets(publicDir, {
      index: false,
      setHeaders: (res: any, path: string) => {
        res.setHeader('Cache-Control', path.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Mọi route không phải /api trả về index.html để React Router xử lý.
    app.use((req: any, res: any, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(publicDir, 'index.html'));
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
