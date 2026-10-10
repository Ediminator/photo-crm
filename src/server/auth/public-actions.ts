/**
 * Explicit allowlist of server actions that do not require an active owner session (AC-9).
 * Maintained in a separate module because 'use server' files can only export async functions.
 */
export const PUBLIC_AUTH_ACTIONS = [
  'setupOwnerAction',
  'signInAction',
  'signOutAction',
  'requestPasswordResetAction',
  'resetPasswordAction',
] as const;

export type PublicAuthAction = (typeof PUBLIC_AUTH_ACTIONS)[number];

export function isPublicAuthAction(actionName: string): boolean {
  return (PUBLIC_AUTH_ACTIONS as readonly string[]).includes(actionName);
}
