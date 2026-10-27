// Single source of the ctk version: tsup inlines it at build time, tsx reads it in dev.
import { version } from '../../package.json';

export const CTK_VERSION: string = version;
