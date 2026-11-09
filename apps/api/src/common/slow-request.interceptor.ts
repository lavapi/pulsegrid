import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { finalize, type Observable } from 'rxjs';

const SLOW_REQUEST_MS = 500;

@Injectable()
export class SlowRequestInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SlowRequestInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        const elapsed = Math.round(performance.now() - startedAt);
        if (elapsed >= SLOW_REQUEST_MS) {
          this.logger.warn(`${request.method} ${request.route?.path ?? 'unknown'} took ${elapsed}ms`);
        }
      }),
    );
  }
}
