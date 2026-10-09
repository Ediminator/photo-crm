import { useTranslations } from 'next-intl';

export default function HomePage() {
  return <HomeContent />;
}

export function HomeContent() {
  const t = useTranslations('home');
  const tPages = useTranslations('pages.dashboard');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <h2 className="text-base font-semibold">{tPages('title')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{tPages('description')}</p>
        </div>
      </div>
    </div>
  );
}
