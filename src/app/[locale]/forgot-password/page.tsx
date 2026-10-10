import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <ForgotPasswordForm locale={locale} />
    </div>
  );
}
