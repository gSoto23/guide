import "./instrument.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";
import { configureApp, createFastifyAdapter, NEST_APP_OPTIONS } from "./bootstrap.js";
import { API_CONFIG, loadApiConfig, type ApiConfig } from "./config/config.js";
import { shutdownObservability } from "@guidesk/observability";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(loadApiConfig()),
    NEST_APP_OPTIONS,
  );
  configureApp(app);
  app.enableShutdownHooks();
  process.on("beforeExit", () => void shutdownObservability());

  const config = app.get<ApiConfig>(API_CONFIG);
  await app.listen(config.PORT, "0.0.0.0");
}

void bootstrap();
