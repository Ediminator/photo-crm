import { useTranslations } from 'next-intl';

export default function SettingsPage() {
  const t = useTranslations('pages.settings');

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>
    </div>
  );
}
