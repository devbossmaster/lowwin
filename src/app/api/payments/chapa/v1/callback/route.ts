import {GET as returnToLowwin,POST as acknowledgeCallback} from '../../callback/route';
export const runtime='nodejs';
// V1 callbacks are unsigned navigation hints. The return page enforces ownership
// and the bounded recovery worker verifies the original stored tx_ref.
export const GET=returnToLowwin;
export const POST=acknowledgeCallback;
