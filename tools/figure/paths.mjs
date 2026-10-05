// Where things live. HERE: this folder (mpfb_src/ = the unpacked MPFB add-on's data, shaped/ = bodies shaped in Blender,
// out/ = results); REPO: the app's repository (engine/, data/, exercises/, index.html); PARAMS: the parameter files.
import { join } from 'node:path';
export const HERE = import.meta.dirname;
export const REPO = join(HERE, '..', '..');
export const PARAMS = import.meta.dirname;
