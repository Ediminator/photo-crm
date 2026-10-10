'use server';

import 'server-only';
import { requireAuth, UnauthorizedError, ForbiddenError } from '@/server/auth/guards';
import { authorizeClientRead, authorizeClientWrite } from './policy';
import {
  createClientInputSchema,
  updateClientInputSchema,
  addContactInputSchema,
  updateContactInputSchema,
  removeContactInputSchema,
  upsertAddressInputSchema,
  removeAddressInputSchema,
  getClientInputSchema,
  listClientsInputSchema,
} from './schema';
import * as clientService from './service';
import type { DbClient } from '@/server/db/client';
import type { AddressType } from '@/server/db/schema/clients';
import type { ClientWithRelations, ListClientsResult } from './repo';

export interface ActionOptions {
  headers?: Headers | Record<string, string | undefined>;
  client?: DbClient;
}

export type ClientActionResult<T> = clientService.ServiceResult<T>;

function extractClientId(input: unknown): string | null {
  if (input !== null && typeof input === 'object' && 'clientId' in input) {
    const val = (input as Record<string, unknown>).clientId;
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

function handleValidationError(error: {
  issues: { path: (string | number)[]; keys?: string[] }[];
}): ClientActionResult<never> {
  const fields = Array.from(
    new Set(
      error.issues.flatMap((issue) => {
        const result: string[] = [];
        if (Array.isArray(issue.keys)) {
          result.push(...issue.keys);
        }
        if (issue.path.length > 0) {
          const fullPath = issue.path.join('.');
          if (fullPath) result.push(fullPath);
          const leaf = String(issue.path[issue.path.length - 1]);
          if (leaf && leaf !== 'undefined') result.push(leaf);
        }
        return result;
      }),
    ),
  );

  return {
    success: false,
    code: 'VALIDATION_FAILED',
    error: 'VALIDATION_FAILED',
    fields,
  };
}

/**
 * Creates a new client and its mandatory primary contact.
 */
export async function createClientAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ clientId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    await authorizeClientWrite('client.created', null, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = createClientInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.createClient(parsed.data, auth, options?.client);
}

/**
 * Updates an existing client record.
 */
export async function updateClientAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ clientId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.updated', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = updateClientInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.updateClient(parsed.data, auth, options?.client);
}

/**
 * Adds a contact to a client.
 */
export async function addContactAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ contactId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.contact.added', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = addContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.addContact(parsed.data, auth, options?.client);
}

/**
 * Updates an existing contact for a client.
 */
export async function updateContactAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ contactId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.contact.updated', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = updateContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.updateContact(parsed.data, auth, options?.client);
}

/**
 * Removes a contact from a client.
 */
export async function removeContactAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ contactId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.contact.removed', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = removeContactInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.removeContact(parsed.data, auth, options?.client);
}

/**
 * Upserts a postal or billing address for a client.
 */
export async function upsertAddressAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ addressId: string }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.address.upserted', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = upsertAddressInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.upsertAddress(parsed.data, auth, options?.client);
}

/**
 * Removes an address from a client by type.
 */
export async function removeAddressAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<{ type: AddressType }>> {
  let auth;
  try {
    auth = await requireAuth({ headers: options?.headers, client: options?.client });
    const targetId = extractClientId(rawInput);
    await authorizeClientWrite('client.address.removed', targetId, auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = removeAddressInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.removeAddress(parsed.data, auth, options?.client);
}

/**
 * Retrieves a client with contacts and addresses by ID.
 */
export async function getClientAction(
  rawInput: unknown,
  options?: ActionOptions,
): Promise<ClientActionResult<ClientWithRelations>> {
  try {
    const auth = await requireAuth({ headers: options?.headers, client: options?.client });
    await authorizeClientRead(auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = getClientInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.getClient(parsed.data.clientId, options?.client);
}

/**
 * Lists clients with pagination, ordered by display_name then id.
 */
export async function listClientsAction(
  rawInput: unknown = {},
  options?: ActionOptions,
): Promise<ClientActionResult<ListClientsResult>> {
  try {
    const auth = await requireAuth({ headers: options?.headers, client: options?.client });
    await authorizeClientRead(auth, options?.client);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { success: false, code: 'UNAUTHORIZED', error: 'UNAUTHORIZED' };
    }
    if (err instanceof ForbiddenError) {
      return { success: false, code: 'FORBIDDEN', error: 'FORBIDDEN' };
    }
    throw err;
  }

  const parsed = listClientsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return handleValidationError(parsed.error);
  }

  return await clientService.getClientList(parsed.data.page, parsed.data.pageSize, options?.client);
}
