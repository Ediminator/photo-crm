import { eq, and, asc, count, ne, inArray } from 'drizzle-orm';
import { db as defaultDb, type DbClient } from '@/server/db/client';
import {
  clients,
  clientContacts,
  clientAddresses,
  type Client,
  type ClientContact,
  type ClientAddress,
  type ClientKind,
  type ClientLocale,
  type AddressType,
} from '@/server/db/schema/clients';
import { generateUuidV7 } from '@/lib/id';

export interface DuplicateEmailMatch {
  clientId: string;
  displayName: string;
}

export interface ClientWithRelations {
  client: Client;
  contacts: ClientContact[];
  addresses: ClientAddress[];
}

export interface ClientListItem {
  id: string;
  kind: ClientKind;
  displayName: string;
  primaryContact: {
    givenName: string | null;
    familyName: string | null;
    email: string | null;
    phone: string | null;
  };
}

export interface ListClientsResult {
  items: ClientListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Checks for existing contacts sharing the same normalized email address.
 * Excludes the given contactId if updating an existing contact.
 */
export async function findDuplicateEmails(
  emailNormalized: string,
  excludeContactId?: string | null,
  client: DbClient = defaultDb,
): Promise<DuplicateEmailMatch[]> {
  const conditions = [eq(clientContacts.emailNormalized, emailNormalized)];
  if (excludeContactId) {
    conditions.push(ne(clientContacts.id, excludeContactId));
  }

  const rows = await client
    .select({
      clientId: clientContacts.clientId,
      displayName: clients.displayName,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clientContacts.clientId, clients.id))
    .where(and(...conditions));

  return rows;
}

/**
 * Retrieves a client along with all its contacts and addresses.
 */
export async function getClientById(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<ClientWithRelations | null> {
  const [clientRow] = await client
    .select({
      id: clients.id,
      kind: clients.kind,
      displayName: clients.displayName,
      preferredLocale: clients.preferredLocale,
      lastActivityAt: clients.lastActivityAt,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);

  if (!clientRow) {
    return null;
  }

  const contacts = await client
    .select({
      id: clientContacts.id,
      clientId: clientContacts.clientId,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
      email: clientContacts.email,
      emailNormalized: clientContacts.emailNormalized,
      phone: clientContacts.phone,
      isPrimary: clientContacts.isPrimary,
      createdAt: clientContacts.createdAt,
      updatedAt: clientContacts.updatedAt,
    })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(asc(clientContacts.createdAt), asc(clientContacts.id));

  const addresses = await client
    .select({
      id: clientAddresses.id,
      clientId: clientAddresses.clientId,
      type: clientAddresses.type,
      line1: clientAddresses.line1,
      line2: clientAddresses.line2,
      postalCode: clientAddresses.postalCode,
      city: clientAddresses.city,
      region: clientAddresses.region,
      countryCode: clientAddresses.countryCode,
      createdAt: clientAddresses.createdAt,
      updatedAt: clientAddresses.updatedAt,
    })
    .from(clientAddresses)
    .where(eq(clientAddresses.clientId, clientId))
    .orderBy(asc(clientAddresses.type));

  return {
    client: clientRow,
    contacts,
    addresses,
  };
}

/**
 * Lists clients with pagination, ordered by display_name then id.
 * Returns each client with its primary contact details.
 */
export async function listClients(
  page = 1,
  pageSize = 25,
  client: DbClient = defaultDb,
): Promise<ListClientsResult> {
  const offset = (page - 1) * pageSize;

  const [totalRow] = await client.select({ total: count() }).from(clients);
  const total = totalRow?.total ?? 0;

  const clientRows = await client
    .select({
      id: clients.id,
      kind: clients.kind,
      displayName: clients.displayName,
    })
    .from(clients)
    .orderBy(asc(clients.displayName), asc(clients.id))
    .limit(pageSize)
    .offset(offset);

  if (clientRows.length === 0) {
    return {
      items: [],
      total,
      page,
      pageSize,
    };
  }

  const clientIds = clientRows.map((c) => c.id);
  const primaryContacts = await client
    .select({
      clientId: clientContacts.clientId,
      givenName: clientContacts.givenName,
      familyName: clientContacts.familyName,
      email: clientContacts.email,
      phone: clientContacts.phone,
    })
    .from(clientContacts)
    .where(and(inArray(clientContacts.clientId, clientIds), eq(clientContacts.isPrimary, true)));

  const primaryContactMap = new Map(primaryContacts.map((c) => [c.clientId, c]));

  const items: ClientListItem[] = clientRows.map((c) => {
    const primary = primaryContactMap.get(c.id);
    return {
      id: c.id,
      kind: c.kind,
      displayName: c.displayName,
      primaryContact: {
        givenName: primary?.givenName ?? null,
        familyName: primary?.familyName ?? null,
        email: primary?.email ?? null,
        phone: primary?.phone ?? null,
      },
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
  };
}

/**
 * Inserts a new client and its mandatory primary contact within a single transaction.
 */
export async function insertClientWithPrimaryContact(
  clientData: {
    kind: ClientKind;
    displayName: string;
    preferredLocale: ClientLocale;
  },
  contactData: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
  },
  dbClient: DbClient = defaultDb,
): Promise<{ clientId: string; contactId: string }> {
  return await dbClient.transaction(async (tx) => {
    const clientId = generateUuidV7();
    const contactId = generateUuidV7();
    const now = new Date();

    await tx.insert(clients).values({
      id: clientId,
      kind: clientData.kind,
      displayName: clientData.displayName,
      preferredLocale: clientData.preferredLocale,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await tx.insert(clientContacts).values({
      id: contactId,
      clientId,
      givenName: contactData.givenName ?? null,
      familyName: contactData.familyName ?? null,
      email: contactData.email ?? null,
      emailNormalized: contactData.emailNormalized ?? null,
      phone: contactData.phone ?? null,
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    });

    return { clientId, contactId };
  });
}

/**
 * Updates a client record and bumps last_activity_at.
 */
export async function updateClientRecord(
  clientId: string,
  updates: {
    kind?: ClientKind;
    displayName?: string;
    preferredLocale?: ClientLocale;
  },
  dbClient: DbClient = defaultDb,
): Promise<Client | null> {
  return await dbClient.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(clients)
      .set({
        ...updates,
        lastActivityAt: now,
        updatedAt: now,
      })
      .where(eq(clients.id, clientId))
      .returning();

    return updated ?? null;
  });
}

/**
 * Counts contacts for a given client.
 */
export async function countClientContacts(
  clientId: string,
  client: DbClient = defaultDb,
): Promise<number> {
  const [row] = await client
    .select({ total: count() })
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId));
  return row?.total ?? 0;
}

/**
 * Inserts a new contact for a client, enforcing primary contact constraints.
 */
export async function insertContact(
  clientId: string,
  contactData: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
  },
  dbClient: DbClient = defaultDb,
): Promise<ClientContact> {
  return await dbClient.transaction(async (tx) => {
    const now = new Date();
    const isPrimary = Boolean(contactData.isPrimary);

    if (isPrimary) {
      // Clear previous primary
      await tx
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)));
    }

    const contactId = generateUuidV7();
    const [inserted] = await tx
      .insert(clientContacts)
      .values({
        id: contactId,
        clientId,
        givenName: contactData.givenName ?? null,
        familyName: contactData.familyName ?? null,
        email: contactData.email ?? null,
        emailNormalized: contactData.emailNormalized ?? null,
        phone: contactData.phone ?? null,
        isPrimary,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!inserted) {
      throw new Error('Failed to insert contact');
    }

    // Bump client last_activity_at
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return inserted;
  });
}

/**
 * Updates a contact record. If switching to primary, unsets previous primary without race condition.
 */
export async function updateContactRecord(
  clientId: string,
  contactId: string,
  updates: {
    givenName?: string | null;
    familyName?: string | null;
    email?: string | null;
    emailNormalized?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
  },
  dbClient: DbClient = defaultDb,
): Promise<ClientContact | null> {
  return await dbClient.transaction(async (tx) => {
    // 1. Verify existence scoped strictly by clientId (IDOR guard)
    const [existing] = await tx
      .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .limit(1);

    if (!existing) {
      return null;
    }

    const now = new Date();

    // 2. If promoting to primary, unset current primary on other contacts first
    if (updates.isPrimary === true && !existing.isPrimary) {
      await tx
        .update(clientContacts)
        .set({ isPrimary: false, updatedAt: now })
        .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.isPrimary, true)));
    }

    // 3. Apply updates
    const [updated] = await tx
      .update(clientContacts)
      .set({
        ...updates,
        updatedAt: now,
      })
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .returning();

    // 4. Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return updated ?? null;
  });
}

/**
 * Removes a contact from a client.
 * Invariant: if removed contact was primary, oldest remaining contact automatically becomes primary.
 */
export async function deleteContactRecord(
  clientId: string,
  contactId: string,
  dbClient: DbClient = defaultDb,
): Promise<{ success: boolean; wasPrimary: boolean; newPrimaryId?: string } | null> {
  return await dbClient.transaction(async (tx) => {
    // Verify existence strictly scoped by clientId
    const [existing] = await tx
      .select({ id: clientContacts.id, isPrimary: clientContacts.isPrimary })
      .from(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)))
      .limit(1);

    if (!existing) {
      return null;
    }

    const now = new Date();

    // Delete contact
    await tx
      .delete(clientContacts)
      .where(and(eq(clientContacts.id, contactId), eq(clientContacts.clientId, clientId)));

    let newPrimaryId: string | undefined;

    // If was primary, promote oldest remaining contact
    if (existing.isPrimary) {
      const [oldest] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId))
        .orderBy(asc(clientContacts.createdAt), asc(clientContacts.id))
        .limit(1);

      if (oldest) {
        newPrimaryId = oldest.id;
        await tx
          .update(clientContacts)
          .set({ isPrimary: true, updatedAt: now })
          .where(eq(clientContacts.id, oldest.id));
      }
    }

    // Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return {
      success: true,
      wasPrimary: existing.isPrimary,
      newPrimaryId,
    };
  });
}

/**
 * Upserts a postal or billing address for a client (1 address per type limit).
 */
export async function upsertAddressRecord(
  clientId: string,
  addressData: {
    type: AddressType;
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    region?: string | null;
    countryCode: string;
  },
  dbClient: DbClient = defaultDb,
): Promise<ClientAddress> {
  return await dbClient.transaction(async (tx) => {
    // Verify client exists
    const [clientRow] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    if (!clientRow) {
      throw new Error('CLIENT_NOT_FOUND');
    }

    const now = new Date();
    const addressId = generateUuidV7();

    const [upserted] = await tx
      .insert(clientAddresses)
      .values({
        id: addressId,
        clientId,
        type: addressData.type,
        line1: addressData.line1,
        line2: addressData.line2 ?? null,
        postalCode: addressData.postalCode,
        city: addressData.city,
        region: addressData.region ?? null,
        countryCode: addressData.countryCode,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [clientAddresses.clientId, clientAddresses.type],
        set: {
          line1: addressData.line1,
          line2: addressData.line2 ?? null,
          postalCode: addressData.postalCode,
          city: addressData.city,
          region: addressData.region ?? null,
          countryCode: addressData.countryCode,
          updatedAt: now,
        },
      })
      .returning();

    if (!upserted) {
      throw new Error('Failed to upsert address');
    }

    // Bump client activity
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return upserted;
  });
}

/**
 * Removes an address from a client by type.
 */
export async function deleteAddressRecord(
  clientId: string,
  type: AddressType,
  dbClient: DbClient = defaultDb,
): Promise<boolean> {
  return await dbClient.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: clientAddresses.id })
      .from(clientAddresses)
      .where(and(eq(clientAddresses.clientId, clientId), eq(clientAddresses.type, type)))
      .limit(1);

    if (!existing) {
      return false;
    }

    await tx
      .delete(clientAddresses)
      .where(and(eq(clientAddresses.clientId, clientId), eq(clientAddresses.type, type)));

    const now = new Date();
    await tx
      .update(clients)
      .set({ lastActivityAt: now, updatedAt: now })
      .where(eq(clients.id, clientId));

    return true;
  });
}
