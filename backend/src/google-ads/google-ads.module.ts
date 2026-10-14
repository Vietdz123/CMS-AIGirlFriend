import { Module } from '@nestjs/common';
import { AdmobCoreModule } from '../admob/admob-core.module';
import { GoogleAdsApiService } from './google-ads-api.service';
import { GoogleAdsSyncService } from './google-ads-sync.service';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';

@Module({
  imports: [AdmobCoreModule],
  controllers: [GoogleAdsController],
  providers: [GoogleAdsApiService, GoogleAdsService, GoogleAdsSyncService],
  exports: [GoogleAdsService, GoogleAdsSyncService],
})
export class GoogleAdsModule {}
