import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Tag, UserCheck } from 'lucide-react';
import type { ClientWithRelations } from '@/server/clients/repo';
import { formatDateTime } from '@/lib/formatters';

export interface ClientProfileProps {
  clientData: ClientWithRelations;
  locale: string;
  studioTimezone: string;
}

export function ClientProfile({ clientData, locale, studioTimezone }: ClientProfileProps) {
  const t = useTranslations('clients.profile');
  const { client, contacts, addresses, tags } = clientData;

  const getCountryName = (countryCode: string) => {
    try {
      const displayNames = new Intl.DisplayNames([locale], { type: 'region' });
      return displayNames.of(countryCode) ?? countryCode;
    } catch {
      return countryCode;
    }
  };

  const cleanPhoneForHref = (phone: string | null) => {
    if (!phone) return '';
    return phone.replace(/[^\d+]/g, '');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto" data-testid="client-profile-view">
      {/* Back Link */}
      <div>
        <Link
          href={`/${locale}/clients`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-2 py-1 min-h-[44px]"
          data-testid="back-to-directory-link"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>{t('backToDirectory')}</span>
        </Link>
      </div>

      {/* Header with single H1 (AC-5) */}
      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              data-testid="client-kind-badge"
            >
              {client.kind === 'company' ? t('kind.company') : t('kind.person')}
            </span>
            <span
              className="inline-flex items-center rounded-md bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
              data-testid="client-locale-badge"
            >
              {t('preferredLanguage')}:{' '}
              {client.preferredLocale === 'de' ? t('language.de') : t('language.en')}
            </span>
          </div>

          <h1
            className="text-2xl md:text-3xl font-bold tracking-tight text-foreground break-words"
            data-testid="client-display-name"
          >
            {client.displayName}
          </h1>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1" data-testid="client-tags-section">
          <Tag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium text-muted-foreground mr-1">{t('tags')}:</span>
          {tags.length > 0 ? (
            tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
              >
                {tag.name}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">{t('noTags')}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Contacts Section */}
        <section
          aria-labelledby="contacts-heading"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 border-b pb-3">
            <UserCheck className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="contacts-heading" className="text-lg font-semibold text-foreground">
              {t('contactsTitle')}
            </h2>
          </div>

          {contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noContacts')}</p>
          ) : (
            <div className="space-y-4 divide-y divide-border">
              {contacts.map((contact, idx) => {
                const fullName =
                  [contact.givenName, contact.familyName].filter(Boolean).join(' ') ||
                  client.displayName;
                const cleanPhone = cleanPhoneForHref(contact.phone);

                return (
                  <div
                    key={contact.id}
                    className={`space-y-2 ${idx > 0 ? 'pt-4' : ''}`}
                    data-testid={`contact-card-${contact.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-sm text-foreground">{fullName}</span>
                      {contact.isPrimary && (
                        <span
                          className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-xs font-medium"
                          data-testid="primary-contact-badge"
                        >
                          {t('primaryBadge')}
                        </span>
                      )}
                    </div>

                    <div className="space-y-1.5 text-sm">
                      {contact.email && (
                        <div className="flex items-center gap-2">
                          <Mail
                            className="h-4 w-4 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <a
                            href={`mailto:${contact.email}`}
                            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center break-all"
                            data-testid={`contact-email-link-${contact.id}`}
                          >
                            {contact.email}
                          </a>
                        </div>
                      )}

                      {contact.phone && (
                        <div className="flex items-center gap-2">
                          <Phone
                            className="h-4 w-4 text-muted-foreground shrink-0"
                            aria-hidden="true"
                          />
                          <a
                            href={`tel:${cleanPhone}`}
                            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded min-h-[24px] inline-flex items-center"
                            data-testid={`contact-phone-link-${contact.id}`}
                          >
                            {contact.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Addresses Section */}
        <section
          aria-labelledby="addresses-heading"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-4"
        >
          <div className="flex items-center gap-2 border-b pb-3">
            <MapPin className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 id="addresses-heading" className="text-lg font-semibold text-foreground">
              {t('addressesTitle')}
            </h2>
          </div>

          {addresses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noAddresses')}</p>
          ) : (
            <div className="space-y-4 divide-y divide-border">
              {addresses.map((addr, idx) => (
                <div
                  key={addr.id}
                  className={`space-y-1 text-sm ${idx > 0 ? 'pt-4' : ''}`}
                  data-testid={`address-card-${addr.type}`}
                >
                  <span className="font-medium text-xs uppercase tracking-wider text-muted-foreground block mb-1">
                    {addr.type === 'billing' ? t('addressType.billing') : t('addressType.postal')}
                  </span>
                  <div className="text-foreground">{addr.line1}</div>
                  {addr.line2 && <div className="text-foreground">{addr.line2}</div>}
                  <div className="text-foreground">
                    {addr.postalCode} {addr.city}
                  </div>
                  {addr.region && <div className="text-muted-foreground">{addr.region}</div>}
                  <div className="font-medium text-foreground">
                    {getCountryName(addr.countryCode)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Timestamps Section */}
      <section
        aria-labelledby="activity-heading"
        className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm space-y-3"
      >
        <div className="flex items-center gap-2 border-b pb-3">
          <Calendar className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="activity-heading" className="text-lg font-semibold text-foreground">
            {t('activityTitle')}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">
              {t('createdAt')}
            </span>
            <span className="font-medium text-foreground" data-testid="client-created-date">
              {formatDateTime(client.createdAt, locale, { timeZone: studioTimezone })}
            </span>
          </div>

          <div>
            <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">
              {t('lastActivityAt')}
            </span>
            <span className="font-medium text-foreground" data-testid="client-last-activity-date">
              {formatDateTime(client.lastActivityAt, locale, { timeZone: studioTimezone })}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
