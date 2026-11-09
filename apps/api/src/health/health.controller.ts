import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/guards/public.decorator';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
