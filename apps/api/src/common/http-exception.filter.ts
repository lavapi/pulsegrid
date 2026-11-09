import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

const clientMessage = (exception: HttpException): string => {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const { message } = body as { message?: string | string[] };
  return Array.isArray(message) ? message.join(' ') : (message ?? GENERIC_MESSAGE);
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({ message: clientMessage(exception) });
      return;
    }

    this.logger.error(exception);
    response.status(500).json({ message: GENERIC_MESSAGE });
  }
}
