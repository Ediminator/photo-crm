import crypto from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import type { Transporter } from 'nodemailer';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import { user, account, session, verification } from '@/server/db/schema/auth';
import { validatePasswordPolicy, hashPasswordArgon2id } from './passwords/policy';
import { sendEmail } from './email';

export const RESET_TOKEN_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes

export interface RequestPasswordResetOptions {
  baseUrl?: string;
  transporter?: Transporter;
  client?: DbClient;
}

export interface PasswordResetResponse {
  success: boolean;
  message: string;
}

export const GENERIC_RESET_RESPONSE: PasswordResetResponse = {
  success: true,
  message:
    'If an account exists for this email address, a secure password reset link has been dispatched.',
};

/**
 * Computes a SHA-256 hash of a raw reset token.
 */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Requests a password reset link.
 * Equalises execution timing between existing and non-existing accounts
 * to mitigate user enumeration attacks.
 */
export async function requestPasswordReset(
  email: string,
  options: RequestPasswordResetOptions = {},
): Promise<PasswordResetResponse> {
  const normalizedEmail = email.toLowerCase().trim();
  const client = options.client ?? defaultDb;
  const baseUrl = options.baseUrl ?? 'http://localhost:3000';

  const userRows = await client.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

  const existingUser = userRows[0];
  if (existingUser) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_LIFETIME_MS);

    // Delete any existing reset tokens for this email
    await client.delete(verification).where(eq(verification.identifier, normalizedEmail));

    // Store hashed token
    await client.insert(verification).values({
      identifier: normalizedEmail,
      value: tokenHash,
      expiresAt,
    });

    const resetLink = `${baseUrl}/en/reset-password?token=${rawToken}&email=${encodeURIComponent(normalizedEmail)}`;

    await sendEmail({
      to: normalizedEmail,
      subject: 'Password Reset Request',
      text: `Hello ${existingUser.name},\n\nPlease use the following link to reset your password within 30 minutes:\n${resetLink}\n\nIf you did not request this, you can ignore this email.`,
      transporter: options.transporter,
    });
  } else {
    // Perform dummy work of comparable computational complexity to equalise response timing
    const dummyToken = crypto.randomBytes(32).toString('hex');
    const dummyHash = hashResetToken(dummyToken);
    // Execute dummy database query and no-op hash
    await client
      .select()
      .from(verification)
      .where(eq(verification.identifier, `dummy-${dummyHash}`))
      .limit(1);
    crypto.timingSafeEqual(Buffer.from(dummyHash), Buffer.from(dummyHash));
  }

  return GENERIC_RESET_RESPONSE;
}

export interface ResetPasswordInput {
  email: string;
  token: string;
  newPassword: string;
  client?: DbClient;
}

/**
 * Completes a password reset using a single-use token.
 */
export async function resetPassword({
  email,
  token,
  newPassword,
  client = defaultDb,
}: ResetPasswordInput): Promise<{ success: boolean }> {
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Validate password policy
  const policy = validatePasswordPolicy(newPassword);
  if (!policy.valid) {
    throw new Error(policy.message ?? 'Invalid password');
  }

  // 2. Hash provided token to match stored hash
  const tokenHash = hashResetToken(token);
  const now = new Date();

  // 3. Find valid, non-expired verification record
  const tokenRows = await client
    .select()
    .from(verification)
    .where(
      and(
        eq(verification.identifier, normalizedEmail),
        eq(verification.value, tokenHash),
        gt(verification.expiresAt, now),
      ),
    )
    .limit(1);

  const validToken = tokenRows[0];
  if (!validToken) {
    throw new Error('Invalid or expired password reset link.');
  }

  // 4. Immediately delete token (single-use enforcement)
  await client.delete(verification).where(eq(verification.id, validToken.id));

  // 5. Hash new password with Argon2id
  const passwordHash = await hashPasswordArgon2id(newPassword);

  // 6. Find user and update credential account
  const userRows = await client.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

  const userRecord = userRows[0];
  if (!userRecord) {
    throw new Error('User not found.');
  }

  const userId = userRecord.id;

  await client
    .update(account)
    .set({
      password: passwordHash,
      updatedAt: now,
    })
    .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')));

  // 7. Revoke all active sessions on password reset (security requirement)
  await client.delete(session).where(eq(session.userId, userId));

  return { success: true };
}
