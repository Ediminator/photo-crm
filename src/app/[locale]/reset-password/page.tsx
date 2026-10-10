import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <ResetPasswordForm locale={locale} />
    </div>
  );
}
