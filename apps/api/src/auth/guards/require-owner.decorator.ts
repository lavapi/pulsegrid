import { SetMetadata } from '@nestjs/common';

export const REQUIRE_OWNER = 'requireOwner';

export const RequireOwner = () => SetMetadata(REQUIRE_OWNER, true);
