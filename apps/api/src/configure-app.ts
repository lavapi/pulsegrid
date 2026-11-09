import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/http-exception.filter';

export const configureApp = (app: NestExpressApplication): void => {
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
};
