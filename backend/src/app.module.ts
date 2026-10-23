import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AdmobModule } from './admob/admob.module';
import { AuthModule } from './auth/auth.module';
import { FxModule } from './common/fx.module';
import { FacebookModule } from './facebook/facebook.module';
import { GoogleAdsModule } from './google-ads/google-ads.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { RetentionModule } from './retention/retention.module';
import { SyncModule } from './sync/sync.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    FxModule,
    AuthModule,
    UsersModule,
    AdmobModule,
    SyncModule,
    ReportsModule,
    RetentionModule,
    FacebookModule,
    GoogleAdsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
