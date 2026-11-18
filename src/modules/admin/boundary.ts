import type { Prisma, PrismaClient } from '@prisma/client';
import { adminSessionExpiry } from '@/lib/admin-security';
import { signedSessionToken } from '../auth/signed-session';
import { AdminError } from './errors';
import { assertPermission, type Permission, type StaffRole } from './permissions';
import { measureAdmin } from './timing';

export const adminHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Cookie',
  'X-Robots-Tag': 'noindex',
};

type AdminSessionRow = {
  id: string;
  userId: string;
  sessionExpiresAt: Date;
  telegramLaunchId: string | null;
  userRole: string;
  emailVerified: boolean;
  telegramId: string | null;
  active: boolean | null;
  credentialAt: Date | null;
  grantExpiresAt: Date | null;
  authMethod: string | null;
};

export function requireAdmin(
  client: Prisma.TransactionClient | PrismaClient,
  headers: Headers,
  options: { lock?: boolean; permission?: Permission } = {},
) {
  return measureAdmin('authorization', async () => {
    const token = await signedSessionToken(headers);
    if (!token) throw new AdminError(401, 'Administrator sign-in required.', 'ADMIN_LOGIN_REQUIRED');

    if (options.lock) {
      await client.$queryRaw`
        SELECT u.id FROM "session" s
        JOIN "user" u ON u.id=s."userId"
        JOIN "StaffMember" m ON m."userId"=u.id
        WHERE s.token=${token} AND s."expiresAt">(${new Date()}::timestamptz AT TIME ZONE 'UTC')
        FOR UPDATE OF u,m
      `;
    }

    // Read the session and grant after waiting for the staff lock. Password
    // reset and logout can revoke a session without taking that lock.
    const now = new Date();
    const [row] = await client.$queryRaw<AdminSessionRow[]>`
      SELECT s.id,s."userId",s."expiresAt" AS "sessionExpiresAt",s."telegramLaunchId",
        u.role AS "userRole",u."emailVerified",u."telegramId",m.active,
        g."credentialAt",g."expiresAt" AS "grantExpiresAt",g."authMethod"
      FROM "session" s
      JOIN "user" u ON u.id=s."userId"
      LEFT JOIN "StaffMember" m ON m."userId"=u.id
      LEFT JOIN "StaffSession" g ON g."sessionId"=s.id
      WHERE s.token=${token} AND s."expiresAt">(${now}::timestamptz AT TIME ZONE 'UTC')
    `;
    if (!row) throw new AdminError(401, 'Administrator sign-in required.', 'ADMIN_LOGIN_REQUIRED');

    const expiresAt = row.credentialAt && row.grantExpiresAt && row.authMethod
      ? adminSessionExpiry(
          { credentialAt: row.credentialAt, expiresAt: row.grantExpiresAt, authMethod: row.authMethod },
          row.sessionExpiresAt,
          now,
        )
      : null;
    if (!expiresAt || !row.active || row.userRole !== 'admin' || !row.emailVerified
      || row.telegramLaunchId !== null || row.telegramId !== null) {
      throw new AdminError(403, 'Sign in with an approved administrator account.', 'ADMIN_LOGIN_REQUIRED');
    }

    const role = 'OWNER' as StaffRole;
    if (options.permission) assertPermission(role, options.permission);
    return { id: row.userId, role, sessionId: row.id, now, mfaAt: null, expiresAt };
  });
}
