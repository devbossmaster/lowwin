# Staff access and recovery

Every staff login requires its existing password plus one successful authenticator challenge. Access ends no later than eight hours after the credential check, even if a cookie or stored grant says otherwise. The pre-authentication challenge lasts 15 minutes. Active staff, current role/permissions and the server session are checked on every protected request. No remembered-device cookie or in-panel fresh-code action grants access.

## Normal recovery

Forgot password always returns the same response. The email reset link expires after 30 minutes and can be used once. Reset revokes affected sessions and trusted-device records; it preserves authenticator enrollment. Sign in again with the new password and authenticator.

For a lost authenticator, use **Use a recovery code** after password verification. A valid unused recovery code revokes existing sessions/devices, invalidates the previous authenticator/recovery set, and requires enrollment before any admin API access. Save the newly displayed recovery codes privately. The browser offers copy/download and requires confirmation before opening the workspace. Codes are returned only during enrollment/recovery; never put them in screenshots or support logs.

Role-aware invitations retain the existing separate staff identity and verified-email flow. There is no public admin registration. An expired unclaimed initial invitation can use the existing guarded reissue process; that process is **not** a way to replace an enrolled production Owner.

## Lost authenticator AND recovery codes

This is an operator-assisted account recovery, not a public bypass. No recovery was performed during the redesign.

1. Pause the recovery attempt and open a restricted incident ticket. Independently verify the original Owner through the protected deployment/billing ownership channel and an established out-of-band contact. A chat message, username, email access alone or a supplied user ID is insufficient.
2. Record the exact existing credential account ID, staff user ID, role and active state from the verified production target. Take a protected backup and record the current deployment/keyring identity. Do not print passwords, contact plaintext, MFA secrets or recovery hashes.
3. Obtain explicit Owner approval for **MFA recovery of that existing identity**, with the incident ID. A second authorized operator should review the exact target and impact when available. Never bootstrap another Owner, delete the user, repoint a credential account or reuse an invitation for a different person.
4. Prepare and rehearse a narrow operator transaction using the established database administration channel: lock the original staff identity; assert its credential/role/active baseline; revoke its sessions and any remembered-device records; invalidate outstanding password-reset tokens for its email; clear only its MFA enrollment/recovery material and reset its TOTP replay counter; append an immutable `OWNER_MFA_OPERATOR_RECOVERY` audit with operator, incident, approval and target identity. Commit all of this together. Preserve the credential password, Telegram/customer relationships, funds, bids and every historical audit record. This deliberately changes only the approved Owner's MFA enrollment; it is outside the redesign's production authorization.
5. The original Owner signs in with their existing credential, enrolls a new authenticator, and saves a new recovery set. Protected access stays denied while enrollment is incomplete. If the password is also lost, use the normal single-use password-reset flow; do not silently remove a second factor through that flow.
6. Confirm old cookies, codes and sessions fail, the original identity/permissions are unchanged, and exactly one enrollment succeeds. Close the incident with redacted evidence and retain the protected recovery backup according to the operator's retention policy.

There is intentionally no unattended lost-both command or URL. A reviewed operator transaction is prepared only for the independently verified original account. Back up the original MFA encryption key separately: replacing the key cannot recover existing authenticator secrets.
