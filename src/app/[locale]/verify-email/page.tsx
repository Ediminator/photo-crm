import { VerifyEmailView } from '@/components/auth/verify-email-view';

export default async function VerifyEmailPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;

  return (
    <div className="flex min-h-[calc(100vh-10rem)] items-center justify-center p-4">
      <VerifyEmailView locale={locale} />
    </div>
  );
}
