import { Module } from "@nestjs/common";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { CsvImportsController } from "./csv-imports.controller.js";
import { CsvImportsService } from "./csv-imports.service.js";
import { ImportRunsController } from "./import-runs.controller.js";
import { ImportRunsService } from "./import-runs.service.js";

/** Import runs shared by PMS and CSV imports, and the CSV routes (feature 002, T094, T109). */
@Module({
  imports: [TenancyModule],
  // The CSV routes come first, so `GET /imports/csv-template` is never read as a run ID.
  controllers: [CsvImportsController, ImportRunsController],
  providers: [ImportRunsService, CsvImportsService],
  exports: [ImportRunsService],
})
export class ImportRunsModule {}
