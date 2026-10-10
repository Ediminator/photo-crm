import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireOwner } from '@/server/auth/guards';
import { getClientList, listTags } from '@/server/clients/service';
import type { ListClientsResult, TagSummaryItem } from '@/server/clients/repo';
import { ClientDirectory } from '@/components/clients/client-directory';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ClientsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; tagId?: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  try {
    const t = await getTranslations({ locale, namespace: 'clients.list' });
    return {
      title: `${t('title')} · Ownlight`,
    };
  } catch {
    const title = locale === 'de' ? 'Kund:innen · Ownlight' : 'Clients · Ownlight';
    return { title };
  }
}

export default async function ClientsPage({ params, searchParams }: ClientsPageProps) {
  const { locale } = await params;

  try {
    await requireOwner();
  } catch {
    redirect(`/${locale}/sign-in?callbackUrl=/${locale}/clients`);
    return null;
  }

  const query = await searchParams;
  const rawPage = parseInt(query.page ?? '1', 10);
  const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const tagId = query.tagId && query.tagId.trim().length > 0 ? query.tagId.trim() : undefined;

  const [clientsRes, tagsRes] = await Promise.all([
    getClientList(page, 25, undefined, tagId),
    listTags(),
  ]);

  const initialClients: ListClientsResult = clientsRes.success
    ? clientsRes.data
    : {
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
      };
  const tags: TagSummaryItem[] = tagsRes.success ? tagsRes.data : [];

  return (
    <div className="container mx-auto px-4 py-6 max-w-6xl">
      <ClientDirectory
        initialClients={initialClients}
        tags={tags}
        locale={locale}
        initialTagId={tagId}
        initialPage={page}
      />
    </div>
  );
}
