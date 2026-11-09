import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { configureApp } from './configure-app';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
};

void bootstrap();
