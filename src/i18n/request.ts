import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';
import enMessages from '../../messages/en.json';
import deMessages from '../../messages/de.json';

export default getRequestConfig(async ({ locale: rawLocale }) => {
  await Promise.resolve();
  const locale =
    rawLocale && hasLocale(routing.locales, rawLocale) ? rawLocale : routing.defaultLocale;

  const messages = locale === 'de' ? deMessages : enMessages;

  return {
    locale,
    messages,
  };
});
