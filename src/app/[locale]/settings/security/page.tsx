import { redirect } from 'next/navigation';
import { requireOwner } from '@/server/auth/guards';
import {
  getMfaStatusAction,
  listPasskeysAction,
  listActiveSessionsAction,
} from '@/server/auth/mfa-actions';
import { SecuritySettingsView } from '@/components/settings/security-settings-view';

export default async function SecuritySettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/settings/security`);
  }

  let status: {
    totpEnabled: boolean;
    passkeyCount: number;
    recoveryCodesRemaining: number;
    mfaRequired: boolean;
    mfaPostponedUntil: Date | null;
    hasMfa: boolean;
  } = {
    totpEnabled: false,
    passkeyCount: 0,
    recoveryCodesRemaining: 0,
    mfaRequired: false,
    mfaPostponedUntil: null,
    hasMfa: false,
  };
  let passkeys: { id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[] = [];
  let sessions: {
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastReauthenticatedAt: Date;
    isCurrent: boolean;
  }[] = [];

  const [statusRes, passkeysRes, sessionsRes] = await Promise.all([
    getMfaStatusAction(),
    listPasskeysAction(),
    listActiveSessionsAction(),
  ]);

  if (statusRes.success && statusRes.data) status = statusRes.data;
  if (passkeysRes.success && passkeysRes.data) passkeys = passkeysRes.data;
  if (sessionsRes.success && sessionsRes.data) sessions = sessionsRes.data;

  return (
    <div className="container mx-auto px-4 py-6">
      <SecuritySettingsView
        initialStatus={status}
        initialPasskeys={passkeys}
        initialSessions={sessions}
        locale={locale}
      />
    </div>
  );
}
