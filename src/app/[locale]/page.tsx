import { useTranslations } from 'next-intl';

export default function HomePage() {
  return <HomeContent />;
}

export function HomeContent() {
  const t = useTranslations('home');

  return (
    <article style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>{t('title')}</h1>
      <p>{t('subtitle')}</p>
      <p>{t('welcome')}</p>
    </article>
  );
}
