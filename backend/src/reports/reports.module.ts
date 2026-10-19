import { Module } from '@nestjs/common';
import { AdmobCoreModule } from '../admob/admob-core.module';
import { ExploreService } from './explore.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AdmobCoreModule],
  controllers: [ReportsController],
  providers: [ReportsService, ExploreService],
})
export class ReportsModule {}
