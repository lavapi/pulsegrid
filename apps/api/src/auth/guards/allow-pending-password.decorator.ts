import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD = 'allowPendingPassword';

export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);
