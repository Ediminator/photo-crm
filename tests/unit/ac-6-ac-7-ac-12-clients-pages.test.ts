import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockRedirect = vi.fn();
const mockNotFound = vi.fn();

vi.mock('next/navigation', () => ({
  redirect: (url: string): void => {
    mockRedirect(url);
  },
  notFound: (): void => {
    mockNotFound();
  },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/en/clients',
  useSearchParams: () => new URLSearchParams(),
}));

const mockRequireOwner = vi.fn();
vi.mock('@/server/auth/guards', () => ({
  requireOwner: (): Promise<{ user: { id: string; role: string } }> =>
    mockRequireOwner() as Promise<{ user: { id: string; role: string } }>,
}));

const mockGetClientList = vi.fn();
const mockListTags = vi.fn();
const mockGetClient = vi.fn();
vi.mock('@/server/clients/service', () => ({
  getClientList: (...args: unknown[]): unknown => mockGetClientList(...args),
  listTags: (...args: unknown[]): unknown => mockListTags(...args),
  getClient: (...args: unknown[]): unknown => mockGetClient(...args),
}));

vi.mock('@/server/settings/repo', () => ({
  getStudioSettings: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
}));

import ClientsPage, {
  generateMetadata as generateClientsMetadata,
} from '@/app/[locale]/clients/page';
import ClientProfilePage, {
  generateMetadata as generateProfileMetadata,
} from '@/app/[locale]/clients/[clientId]/page';

describe('TASK-0011: Clients Route Pages (AC-6, AC-7, AC-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC-7: unauthenticated request to /en/clients redirects to sign-in with callbackUrl', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    await ClientsPage({
      params: Promise.resolve({ locale: 'en' }),
      searchParams: Promise.resolve({}),
    });

    expect(mockRedirect).toHaveBeenCalledWith('/en/sign-in?callbackUrl=/en/clients');
  });

  it('AC-7: unauthenticated request to client profile redirects to sign-in with callbackUrl', async () => {
    mockRequireOwner.mockRejectedValueOnce(new Error('UNAUTHORIZED'));

    await ClientProfilePage({
      params: Promise.resolve({
        locale: 'en',
        clientId: '018f0000-0000-7000-8000-000000000001',
      }),
    });

    expect(mockRedirect).toHaveBeenCalledWith(
      '/en/sign-in?callbackUrl=/en/clients/018f0000-0000-7000-8000-000000000001',
    );
  });

  it('AC-6: malformed / non-UUID clientId in profile URL invokes notFound()', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });

    await ClientProfilePage({
      params: Promise.resolve({
        locale: 'en',
        clientId: 'not-a-valid-uuid-12345',
      }),
    });

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('AC-6: non-existent random UUID in profile URL invokes notFound() and displays no client data', async () => {
    mockRequireOwner.mockResolvedValueOnce({ user: { id: 'owner-1', role: 'owner' } });
    mockGetClient.mockResolvedValueOnce({
      success: false,
      code: 'NOT_FOUND',
      error: 'NOT_FOUND',
    });

    await ClientProfilePage({
      params: Promise.resolve({
        locale: 'en',
        clientId: '018f0000-0000-7000-8000-999999999999',
      }),
    });

    expect(mockNotFound).toHaveBeenCalled();
  });

  it('AC-12: document title for directory and profile contains zero personal data', async () => {
    const clientsMeta = await generateClientsMetadata({
      params: Promise.resolve({ locale: 'en' }),
    });
    const clientsTitle = typeof clientsMeta.title === 'string' ? clientsMeta.title : '';
    expect(clientsTitle).not.toBe('');
    expect(clientsTitle).not.toMatch(/@/);
    expect(clientsTitle).not.toMatch(/\+?\d{5,}/);
    expect(clientsTitle).toContain('Ownlight');

    const profileMeta = await generateProfileMetadata({
      params: Promise.resolve({
        locale: 'en',
        clientId: '018f0000-0000-7000-8000-000000000001',
      }),
    });
    const profileTitle = typeof profileMeta.title === 'string' ? profileMeta.title : '';
    expect(profileTitle).not.toBe('');
    expect(profileTitle).not.toMatch(/@/);
    expect(profileTitle).not.toMatch(/\+?\d{5,}/);
    expect(profileTitle).toContain('Ownlight');
  });
});
