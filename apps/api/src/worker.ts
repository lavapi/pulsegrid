import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
};

void bootstrap();
