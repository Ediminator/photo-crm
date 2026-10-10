'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { signOutEverywhereAction } from '@/server/auth/actions';
import {
  startTotpEnrolmentAction,
  verifyAndEnableTotpAction,
  disableTotpAction,
  regenerateRecoveryCodesAction,
  reauthenticateAction,
  startPasskeyRegistrationAction,
  completePasskeyRegistrationAction,
  deletePasskeyAction,
  postponeMfaAction,
  revokeSessionByIdAction,
} from '@/server/auth/mfa-actions';
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  isWebAuthnSupported,
  type RegistrationResponseJSON,
} from '@/lib/webauthn-client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { formatDate } from '@/lib/formatters';
import {
  Shield,
  Smartphone,
  Key,
  Monitor,
  AlertTriangle,
  Check,
  Copy,
  Download,
  RefreshCw,
  Trash2,
} from 'lucide-react';

interface SafeQrSvgProps {
  svgString: string;
  ariaLabel: string;
}

function SafeQrSvg({ svgString, ariaLabel }: SafeQrSvgProps) {
  const viewBoxMatch = /viewBox="([^"]+)"/.exec(svgString);
  const pathMatch = /d="([^"]+)"/.exec(svgString);
  const viewBox = viewBoxMatch?.[1] ?? '0 0 310 310';
  const pathD = pathMatch?.[1] ?? '';

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={viewBox}
      className="w-full h-full text-foreground"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="white" width="100%" height="100%" />
      {pathD && <path fill="currentColor" d={pathD} />}
    </svg>
  );
}

interface SecuritySettingsViewProps {
  initialStatus: {
    totpEnabled: boolean;
    passkeyCount: number;
    recoveryCodesRemaining: number;
    mfaRequired: boolean;
    mfaPostponedUntil: Date | null;
    hasMfa: boolean;
  };
  initialPasskeys: {
    id: string;
    name: string;
    createdAt: Date;
    lastUsedAt: Date | null;
  }[];
  initialSessions: {
    id: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
    lastReauthenticatedAt: Date;
    isCurrent: boolean;
  }[];
  locale: string;
}

export function SecuritySettingsView({
  initialStatus,
  initialPasskeys,
  initialSessions,
  locale,
}: SecuritySettingsViewProps) {
  const t = useTranslations('settings.security');
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEnforced =
    searchParams.get('mfa_enforced') === '1' || searchParams.get('enforce_mfa') === '1';

  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus);
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [sessions, setSessions] = useState(initialSessions);

  // TOTP Enrolment state
  const [enrollingTotp, setEnrollingTotp] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrSvg, setTotpQrSvg] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Recovery Codes Modal state
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Passkey Registration state
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');

  // Re-authentication Modal state
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => Promise<void>) | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const setNotice = (msg: string) => {
    setSuccessMessage(msg);
    setError(null);
  };

  const getErrorMessage = (code?: string, defaultError?: string) => {
    if (code) {
      try {
        if (t.has(`errors.${code}`)) {
          return t(`errors.${code}`);
        }
      } catch {
        // Fall through
      }
    }
    return defaultError ?? t('errors.INVALID_INPUT');
  };

  // Re-authentication helper
  const handleReauthSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await reauthenticateAction({ password: reauthPassword });
      if (!result.success) {
        setError(getErrorMessage(result.code, result.error));
        return;
      }

      setReauthModalOpen(false);
      setReauthPassword('');

      if (pendingAction) {
        const action = pendingAction;
        setPendingAction(null);
        await action();
      }
    });
  };

  // TOTP: Start Enrolment
  const handleStartTotp = () => {
    setError(null);
    startTransition(async () => {
      const res = await startTotpEnrolmentAction();
      if (!res.success || !res.data) {
        setError(getErrorMessage(res.code, res.error ?? t('errors.failedToStart')));
        return;
      }
      setTotpSecret(res.data.secret);
      setTotpQrSvg(res.data.qrSvg);
      setEnrollingTotp(true);
    });
  };

  // TOTP: Verify and Activate
  const handleVerifyTotp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await verifyAndEnableTotpAction({ code: verifyCode });
      if (!res.success || !res.data) {
        setError(getErrorMessage(res.code, res.error ?? t('errors.failedToVerify')));
        return;
      }

      setEnrollingTotp(false);
      setVerifyCode('');
      setRecoveryCodes(res.data.recoveryCodes);
      setStatus((prev) => ({
        ...prev,
        totpEnabled: true,
        hasMfa: true,
        mfaRequired: true,
      }));
      setNotice(t('notices.totpEnabled'));
      router.refresh();
    });
  };

  // TOTP: Disable
  const handleDisableTotp = () => {
    setError(null);
    const execute = async () => {
      const res = await disableTotpAction();
      if (!res.success) {
        if (res.code === 'REAUTH_REQUIRED') {
          setPendingAction(() => execute);
          setReauthModalOpen(true);
        } else {
          setError(getErrorMessage(res.code, res.error));
        }
        return;
      }
      setStatus((prev) => ({
        ...prev,
        totpEnabled: false,
        hasMfa: prev.passkeyCount > 0,
      }));
      setNotice(t('notices.totpDisabled'));
      router.refresh();
    };

    startTransition(execute);
  };

  // Recovery Codes: Regenerate
  const handleRegenerateCodes = () => {
    setError(null);
    const execute = async () => {
      const res = await regenerateRecoveryCodesAction();
      if (!res.success || !res.data) {
        if (res.code === 'REAUTH_REQUIRED') {
          setPendingAction(() => execute);
          setReauthModalOpen(true);
        } else {
          setError(getErrorMessage(res.code, res.error ?? t('errors.failedToRegenerate')));
        }
        return;
      }
      setRecoveryCodes(res.data.recoveryCodes);
      setNotice(t('notices.recoveryCodesRegenerated'));
    };

    startTransition(execute);
  };

  // Passkey: Register
  const handleCompleteRegisterPasskey = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!isWebAuthnSupported()) {
      setError(t('errors.webauthnUnsupported'));
      return;
    }

    startTransition(async () => {
      try {
        const startRes = await startPasskeyRegistrationAction();
        if (!startRes.success || !startRes.data) {
          setError(getErrorMessage(startRes.code, startRes.error ?? t('errors.failedToStart')));
          return;
        }

        const options = startRes.data.options;
        const creationOptions: PublicKeyCredentialCreationOptions = {
          challenge: base64UrlToBuffer(options.challenge),
          rp: options.rp,
          user: {
            id: base64UrlToBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          pubKeyCredParams: options.pubKeyCredParams,
          authenticatorSelection: options.authenticatorSelection,
          timeout: options.timeout,
          attestation: options.attestation,
        };

        const cred = (await navigator.credentials.create({
          publicKey: creationOptions,
        })) as PublicKeyCredential | null;

        if (!cred) {
          setError(t('errors.passkeyCancelled'));
          return;
        }

        const response = cred.response as AuthenticatorAttestationResponse;
        const getTransportsFn = (response as unknown as { getTransports?: () => string[] })
          .getTransports;
        const transports =
          typeof getTransportsFn === 'function' ? getTransportsFn.call(response) : undefined;

        const regResponse: RegistrationResponseJSON = {
          id: cred.id,
          rawId: cred.id,
          response: {
            clientDataJSON: bufferToBase64Url(response.clientDataJSON),
            attestationObject: bufferToBase64Url(response.attestationObject),
            transports,
          },
        };

        const completeRes = await completePasskeyRegistrationAction({
          name: passkeyName,
          response: regResponse,
        });

        if (!completeRes.success || !completeRes.data) {
          setError(getErrorMessage(completeRes.code, completeRes.error));
          return;
        }

        const passkeyData = completeRes.data.passkey;
        setPasskeys((prev) => [
          ...prev,
          {
            id: passkeyData.id,
            name: passkeyData.name,
            createdAt: passkeyData.createdAt,
            lastUsedAt: null,
          },
        ]);
        setStatus((prev) => ({
          ...prev,
          passkeyCount: prev.passkeyCount + 1,
          hasMfa: true,
        }));
        setRegisteringPasskey(false);
        setPasskeyName('');
        setNotice(t('notices.passkeyRegistered'));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.INVALID_INPUT'));
      }
    });
  };

  // Passkey: Delete
  const handleDeletePasskey = (passkeyId: string) => {
    setError(null);
    const execute = async () => {
      const res = await deletePasskeyAction({ passkeyId });
      if (!res.success) {
        if (res.code === 'REAUTH_REQUIRED') {
          setPendingAction(() => execute);
          setReauthModalOpen(true);
        } else {
          setError(getErrorMessage(res.code, res.error));
        }
        return;
      }

      setPasskeys((prev) => prev.filter((p) => p.id !== passkeyId));
      setStatus((prev) => ({
        ...prev,
        passkeyCount: Math.max(0, prev.passkeyCount - 1),
        hasMfa: prev.totpEnabled || prev.passkeyCount - 1 > 0,
      }));
      setNotice(t('notices.passkeyDeleted'));
      router.refresh();
    };

    startTransition(execute);
  };

  // Sessions: Revoke by ID
  const handleRevokeSession = (sessionId: string) => {
    setError(null);
    startTransition(async () => {
      const res = await revokeSessionByIdAction({ sessionId });
      if (!res.success) {
        setError(getErrorMessage(res.code, res.error));
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setNotice(t('notices.sessionRevoked'));
    });
  };

  // Sessions: Sign out everywhere
  const handleSignOutEverywhere = () => {
    setError(null);
    startTransition(async () => {
      await signOutEverywhereAction();
      router.push(`/${locale}/sign-in`);
      router.refresh();
    });
  };

  // MFA Postpone
  const handlePostponeMfa = () => {
    setError(null);
    startTransition(async () => {
      const res = await postponeMfaAction();
      if (!res.success || !res.data) {
        setError(getErrorMessage(res.code, res.error));
        return;
      }
      const postponeData = res.data;
      setStatus((prev) => ({
        ...prev,
        mfaPostponedUntil: postponeData.postponedUntil,
      }));
      setNotice(t('postponeSuccess', { date: formatDate(postponeData.postponedUntil, locale) }));
    });
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto py-2">
      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" aria-hidden="true" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">{t('description')}</p>
      </div>

      {/* Mandatory Enforced MFA Notice / Postpone Banner */}
      {isEnforced && !status.hasMfa && (
        <div
          role="alert"
          data-testid="mfa-enforcement-alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5"
              aria-hidden="true"
            />
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t('mfaEnforcedAlert')}</p>
              {status.mfaPostponedUntil && (
                <p className="text-xs text-muted-foreground">
                  {t('mfaPostponeNotice', {
                    date: formatDate(status.mfaPostponedUntil, locale),
                  })}
                </p>
              )}
              <button
                type="button"
                data-testid="postpone-mfa-btn"
                onClick={handlePostponeMfa}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-white dark:bg-black px-3 py-1.5 text-xs font-medium text-foreground shadow-sm border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t('postponeBtn')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Alerts */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          data-testid="security-error-alert"
          className="rounded-md border border-red-300 bg-red-100 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200 font-medium"
        >
          {error}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="security-success-alert"
          className="rounded-md border border-green-300 bg-green-100 p-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200 font-medium flex items-center gap-2"
        >
          <Check className="h-4 w-4 text-green-600" aria-hidden="true" />
          {successMessage}
        </div>
      )}

      {/* Card 1: TOTP Authenticator App */}
      <section
        aria-labelledby="totp-heading"
        className="rounded-xl border bg-card p-6 shadow-sm space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 id="totp-heading" className="text-xl font-semibold flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('totpTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('totpDescription')}</p>
          </div>

          <div>
            <span
              data-testid="totp-status-badge"
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                status.totpEnabled
                  ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {status.totpEnabled ? t('totpActive') : t('totpInactive')}
            </span>
          </div>
        </div>

        {!status.totpEnabled && !enrollingTotp && (
          <button
            type="button"
            data-testid="setup-totp-btn"
            onClick={handleStartTotp}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 shadow-sm"
          >
            {t('enableTotp')}
          </button>
        )}

        {/* Enrolment Form with local SVG QR code */}
        {enrollingTotp && (
          <div data-testid="totp-enrolment-panel" className="border-t pt-6 space-y-6">
            <div className="space-y-2">
              <h3 className="text-lg font-medium">{t('totpSetupTitle')}</h3>
              <p className="text-sm text-muted-foreground">{t('totpSetupInstructions')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
              {/* Local Vector SVG QR Code with accessible alternative (Safe pure React component) */}
              <div className="flex flex-col items-center p-4 bg-white dark:bg-white rounded-lg border shadow-inner max-w-[280px] mx-auto">
                <div
                  data-testid="totp-qr-code"
                  className="w-56 h-56 flex items-center justify-center text-black"
                >
                  <SafeQrSvg svgString={totpQrSvg} ariaLabel={t('qrCodeAlt')} />
                </div>
              </div>

              {/* Accessible Manual Key Alternative */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="totp-secret-text" className="text-sm font-medium text-foreground">
                    {t('manualSecretLabel')}
                  </label>
                  <div className="flex items-center gap-2">
                    <code
                      id="totp-secret-text"
                      data-testid="totp-manual-secret"
                      className="p-2.5 rounded bg-muted font-mono text-sm tracking-wider break-all select-all flex-1 border"
                    >
                      {totpSecret}
                    </code>
                    <button
                      type="button"
                      data-testid="copy-secret-btn"
                      onClick={() => {
                        void navigator.clipboard.writeText(totpSecret);
                        setCopiedSecret(true);
                        setTimeout(() => {
                          setCopiedSecret(false);
                        }, 2000);
                      }}
                      aria-label={t('copySecret')}
                      className="inline-flex items-center justify-center p-2.5 rounded border bg-background hover:bg-accent text-foreground"
                    >
                      {copiedSecret ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Verification Form */}
                <form onSubmit={handleVerifyTotp} className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor="totp-verify-input"
                      className="text-sm font-medium text-foreground"
                    >
                      {t('verifyCodeLabel')}
                    </label>
                    <input
                      id="totp-verify-input"
                      data-testid="totp-verify-input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      value={verifyCode}
                      onChange={(e) => {
                        setVerifyCode(e.target.value);
                      }}
                      placeholder={t('verifyCodePlaceholder')}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 font-mono text-center tracking-widest text-lg"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="submit"
                      data-testid="totp-activate-btn"
                      disabled={isPending || verifyCode.trim().length !== 6}
                      className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 py-2 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      {isPending ? t('activatingTotp') : t('activateTotp')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEnrollingTotp(false);
                      }}
                      className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 py-2 px-4"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Enabled Actions */}
        {status.totpEnabled && (
          <div className="border-t pt-4 flex flex-wrap gap-3">
            <button
              type="button"
              data-testid="regenerate-codes-btn"
              onClick={handleRegenerateCodes}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t('regenerateRecoveryCodes')}
            </button>

            <button
              type="button"
              data-testid="disable-totp-btn"
              onClick={handleDisableTotp}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900 bg-background hover:bg-red-50 dark:hover:bg-red-950/50 h-9 px-3"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('disableTotp')}
            </button>
          </div>
        )}
      </section>

      {/* Recovery Codes Display Modal (Radix Dialog) */}
      <Dialog
        open={Boolean(recoveryCodes)}
        onOpenChange={(open) => {
          if (!open) setRecoveryCodes(null);
        }}
      >
        <DialogContent data-testid="recovery-codes-display" className="max-w-lg space-y-6">
          <DialogHeader className="space-y-2">
            <DialogTitle id="recovery-codes-heading" className="text-xl font-bold">
              {t('recoveryCodesTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('recoveryCodesDescription')}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-200">
            {t('recoveryCodesWarning')}
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 bg-muted rounded-lg font-mono text-center text-sm font-semibold select-all">
            {recoveryCodes?.map((code) => (
              <div
                key={code}
                data-testid="recovery-code-item"
                className="p-1.5 bg-background rounded border"
              >
                {code}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="copy-recovery-codes-btn"
                onClick={() => {
                  if (recoveryCodes) {
                    void navigator.clipboard.writeText(recoveryCodes.join('\n'));
                    setCopiedCodes(true);
                    setTimeout(() => {
                      setCopiedCodes(false);
                    }, 2000);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background hover:bg-accent text-xs font-medium h-9 px-3"
              >
                {copiedCodes ? (
                  <Check className="h-3.5 w-3.5 text-green-600" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {t('copyRecoveryCodes')}
              </button>

              <button
                type="button"
                data-testid="download-recovery-codes-btn"
                onClick={() => {
                  if (recoveryCodes) {
                    const blob = new Blob([recoveryCodes.join('\n')], {
                      type: 'text/plain;charset=utf-8',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `setline-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background hover:bg-accent text-xs font-medium h-9 px-3"
              >
                <Download className="h-3.5 w-3.5" />
                {t('downloadRecoveryCodes')}
              </button>
            </div>

            <button
              type="button"
              data-testid="confirm-recovery-codes-btn"
              onClick={() => {
                setRecoveryCodes(null);
              }}
              className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-medium h-9 px-4"
            >
              {t('confirmRecoveryCodes')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Card 2: Passkeys (WebAuthn) */}
      <section
        aria-labelledby="passkeys-heading"
        className="rounded-xl border bg-card p-6 shadow-sm space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 id="passkeys-heading" className="text-xl font-semibold flex items-center gap-2">
              <Key className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('passkeysTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('passkeysDescription')}</p>
          </div>

          <button
            type="button"
            data-testid="register-passkey-btn"
            onClick={() => {
              setRegisteringPasskey(true);
            }}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-10 py-2 px-4 shadow-sm"
          >
            {t('registerPasskey')}
          </button>
        </div>

        {/* Register Passkey Form */}
        {registeringPasskey && (
          <form
            onSubmit={handleCompleteRegisterPasskey}
            data-testid="passkey-register-form"
            className="border-t pt-4 space-y-4 max-w-md"
          >
            <div className="space-y-1.5">
              <label htmlFor="passkey-name-input" className="text-sm font-medium text-foreground">
                {t('passkeyNameLabel')}
              </label>
              <input
                id="passkey-name-input"
                data-testid="passkey-name-input"
                type="text"
                required
                value={passkeyName}
                onChange={(e) => {
                  setPasskeyName(e.target.value);
                }}
                placeholder={t('passkeyNamePlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                data-testid="passkey-submit-btn"
                disabled={isPending || !passkeyName.trim()}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 disabled:opacity-50"
              >
                {isPending ? t('registeringPasskey') : t('registerPasskey')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setRegisteringPasskey(false);
                }}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4"
              >
                {t('cancel')}
              </button>
            </div>
          </form>
        )}

        {/* Passkeys List */}
        <div data-testid="passkeys-list" className="border-t pt-4 divide-y">
          {passkeys.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{t('noPasskeys')}</p>
          ) : (
            passkeys.map((pk) => (
              <div
                key={pk.id}
                data-testid="passkey-item"
                className="py-3 flex items-center justify-between gap-4"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-foreground">{pk.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('passkeyCreated', { date: formatDate(pk.createdAt, locale) })}
                    {pk.lastUsedAt && (
                      <>
                        {' '}
                        ·{' '}
                        {t('passkeyLastUsed', {
                          date: formatDate(pk.lastUsedAt, locale),
                        })}
                      </>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="delete-passkey-btn"
                  onClick={() => {
                    handleDeletePasskey(pk.id);
                  }}
                  disabled={isPending}
                  aria-label={`${t('deletePasskey')} ${pk.name}`}
                  className="inline-flex items-center justify-center p-2 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Card 3: Active Sessions */}
      <section
        aria-labelledby="sessions-heading"
        className="rounded-xl border bg-card p-6 shadow-sm space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 id="sessions-heading" className="text-xl font-semibold flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('sessionsTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('sessionsDescription')}</p>
          </div>

          <button
            type="button"
            data-testid="sign-out-everywhere-btn"
            onClick={handleSignOutEverywhere}
            disabled={isPending}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-3 text-red-600 dark:text-red-400"
          >
            {t('signOutEverywhere')}
          </button>
        </div>

        <div data-testid="sessions-list" className="border-t pt-4 divide-y">
          {sessions.map((s) => (
            <div
              key={s.id}
              data-testid="session-item"
              className="py-3 flex items-center justify-between gap-4"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {s.ipAddress ?? '127.0.0.1'}
                  </p>
                  {s.isCurrent && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                      {t('currentSession')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate max-w-sm">
                  {s.userAgent ?? 'Unknown Browser'}
                </p>
              </div>

              {!s.isCurrent && (
                <button
                  type="button"
                  data-testid="revoke-session-btn"
                  onClick={() => {
                    handleRevokeSession(s.id);
                  }}
                  disabled={isPending}
                  className="inline-flex items-center justify-center text-xs font-medium text-red-600 dark:text-red-400 hover:underline px-2 py-1"
                >
                  {t('revokeSession')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Re-Authentication Modal (AC-6, Radix Dialog) */}
      <Dialog
        open={reauthModalOpen}
        onOpenChange={(open) => {
          if (!open) {
            setReauthModalOpen(false);
            setPendingAction(null);
            setReauthPassword('');
          }
        }}
      >
        <DialogContent data-testid="reauth-modal" className="max-w-md space-y-4">
          <DialogHeader className="space-y-1">
            <DialogTitle id="reauth-modal-title" className="text-lg font-bold">
              {t('reauthTitle')}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {t('reauthDescription')}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleReauthSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="reauth-password-input"
                className="text-sm font-medium text-foreground"
              >
                {t('reauthPassword')}
              </label>
              <input
                id="reauth-password-input"
                data-testid="reauth-password-input"
                type="password"
                required
                value={reauthPassword}
                onChange={(e) => {
                  setReauthPassword(e.target.value);
                }}
                placeholder={t('reauthPasswordPlaceholder')}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setReauthModalOpen(false);
                  setPendingAction(null);
                  setReauthPassword('');
                }}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium border border-input bg-background hover:bg-accent h-9 px-4"
              >
                {t('cancel')}
              </button>
              <button
                type="submit"
                data-testid="reauth-submit-btn"
                disabled={isPending || !reauthPassword.trim()}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 disabled:opacity-50"
              >
                {isPending ? t('confirmingReauth') : t('confirmReauth')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
