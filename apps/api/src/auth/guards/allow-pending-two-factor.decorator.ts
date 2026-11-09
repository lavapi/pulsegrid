import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_TWO_FACTOR = 'allowPendingTwoFactor';

export const AllowPendingTwoFactor = () => SetMetadata(ALLOW_PENDING_TWO_FACTOR, true);
