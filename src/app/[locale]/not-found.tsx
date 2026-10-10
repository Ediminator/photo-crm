import Link from 'next/link';
import { useTranslations } from 'next-intl';

export default function NotFound() {
  const t = useTranslations('clients.profile');
  const tNav = useTranslations('nav');

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center space-y-4 text-center p-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t('notFoundTitle')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('notFoundDescription')}</p>
      </div>
      <div className="pt-2">
        <Link
          href="/clients"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {tNav('clients')}
        </Link>
      </div>
    </div>
  );
}
