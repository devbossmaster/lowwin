import {Prisma} from '@prisma/client';

// Cover the full legacy bigint range plus cents and intermediate sums. Never
// route financial arithmetic through JavaScript Number or round input values.
Prisma.Decimal.set({precision:40,toExpNeg:-30,toExpPos:40});
