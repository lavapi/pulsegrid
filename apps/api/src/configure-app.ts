import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { sameOriginOnly } from './common/same-origin';
import { APP_CONFIG, type AppConfig } from './config/app-config';

export const configureApp = (app: NestExpressApplication): void => {
  app.setGlobalPrefix('api');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use(sameOriginOnly(app.get<AppConfig>(APP_CONFIG).publicUrl));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();
};
