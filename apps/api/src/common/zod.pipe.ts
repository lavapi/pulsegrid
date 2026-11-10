import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodType<T, unknown>,
    private readonly invalidMessage: string,
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(this.invalidMessage);
    }
    return result.data;
  }
}
