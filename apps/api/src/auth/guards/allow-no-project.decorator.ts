import { SetMetadata } from '@nestjs/common';

export const ALLOW_NO_PROJECT = 'allowNoProject';

export const AllowNoProject = () => SetMetadata(ALLOW_NO_PROJECT, true);

export const RequireProject = () => SetMetadata(ALLOW_NO_PROJECT, false);
