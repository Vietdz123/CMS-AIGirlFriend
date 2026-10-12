import { Module } from '@nestjs/common';
import { FacebookApiService } from './facebook-api.service';
import { FacebookSyncService } from './facebook-sync.service';
import { FacebookController } from './facebook.controller';

@Module({
  controllers: [FacebookController],
  providers: [FacebookApiService, FacebookSyncService],
  exports: [FacebookSyncService],
})
export class FacebookModule {}
