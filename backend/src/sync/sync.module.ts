import { Module } from '@nestjs/common';
import { AdmobCoreModule } from '../admob/admob-core.module';
import { FacebookModule } from '../facebook/facebook.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AdmobCoreModule, FacebookModule],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
