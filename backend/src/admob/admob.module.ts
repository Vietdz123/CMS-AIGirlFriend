import { Module } from '@nestjs/common';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { SyncModule } from '../sync/sync.module';
import { AdmobCoreModule } from './admob-core.module';
import { AdmobController } from './admob.controller';
import { AdmobService } from './admob.service';

@Module({
  imports: [AdmobCoreModule, SyncModule, GoogleAdsModule],
  controllers: [AdmobController],
  providers: [AdmobService],
})
export class AdmobModule {}
