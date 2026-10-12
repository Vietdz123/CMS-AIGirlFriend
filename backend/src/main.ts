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
    app.useStaticAssets(publicDir, { index: false, maxAge: '1h' });
    // Mọi route không phải /api trả về index.html để React Router xử lý.
    app.use((req: any, res: any, next: () => void) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
      res.sendFile(join(publicDir, 'index.html'));
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
