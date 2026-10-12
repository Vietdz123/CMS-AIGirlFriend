import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { AdmobCoreModule } from './admob-core.module';
import { AdmobController } from './admob.controller';
import { AdmobService } from './admob.service';

@Module({
  imports: [AdmobCoreModule, SyncModule],
  controllers: [AdmobController],
  providers: [AdmobService],
})
export class AdmobModule {}
