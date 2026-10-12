import { Module } from '@nestjs/common';
import { AdmobApiService } from './admob-api.service';
import { InventoryService } from './inventory.service';

@Module({
  providers: [AdmobApiService, InventoryService],
  exports: [AdmobApiService, InventoryService],
})
export class AdmobCoreModule {}
