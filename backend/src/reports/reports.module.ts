import { Module } from '@nestjs/common';
import { AdmobCoreModule } from '../admob/admob-core.module';
import { IapModule } from '../iap/iap.module';
import { ExploreService } from './explore.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AdmobCoreModule, IapModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExploreService],
})
export class ReportsModule {}
