import crypto from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { env } from '@/env';

export interface WebAuthnConfig {
  rpId: string;
  origin: string;
  rpName: string;
}

/**
 * Returns WebAuthn configuration (RP ID, Origin, RP Name) strictly derived from AUTH_URL.
 */
export function getWebAuthnConfig(customBaseUrl?: string): WebAuthnConfig {
  let rawUrl = 'http://localhost:3000';
  if (customBaseUrl) {
    rawUrl = customBaseUrl;
  } else {
    try {
      rawUrl = env.AUTH_URL;
    } catch {
      rawUrl = process.env.AUTH_URL ?? rawUrl;
    }
  }

  try {
    const parsed = new URL(rawUrl);
    return {
      rpId: parsed.hostname,
      origin: parsed.origin,
      rpName: 'Photo CRM',
    };
  } catch {
    return {
      rpId: 'localhost',
      origin: 'http://localhost:3000',
      rpName: 'Photo CRM',
    };
  }
}

/**
 * Generates a 32-byte cryptographically random challenge encoded as base64url.
 */
export function generateWebAuthnChallenge(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Encodes JavaScript data structures into standard CBOR using audited @simplewebauthn/server helper (I1-V08).
 */
export function encodeCbor(value: unknown): Buffer {
  return Buffer.from(isoCBOR.encode(value as Parameters<typeof isoCBOR.encode>[0]));
}

/**
 * Decodes a CBOR buffer into JavaScript types using audited @simplewebauthn/server helper (I1-V08).
 */
export function decodeCbor(buffer: Buffer): unknown {
  return isoCBOR.decodeFirst(new Uint8Array(buffer));
}

/**
 * Creates standard PublicKeyCredentialCreationOptions for WebAuthn passkey registration.
 */
export function createRegistrationOptions(
  user: { id: string; email: string; name: string },
  challenge: string,
  rpId?: string,
  rpName = 'Photo CRM',
) {
  const config = getWebAuthnConfig();
  const effectiveRpId = rpId ?? config.rpId;

  return {
    challenge,
    rp: {
      id: effectiveRpId,
      name: rpName,
    },
    user: {
      id: Buffer.from(user.id).toString('base64url'),
      name: user.email,
      displayName: user.name,
    },
    pubKeyCredParams: [
      { type: 'public-key' as const, alg: -7 }, // ES256
      { type: 'public-key' as const, alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey: 'preferred' as const,
      userVerification: 'preferred' as const,
    },
    timeout: 60000,
    attestation: 'none' as const,
  };
}

/**
 * Creates standard PublicKeyCredentialRequestOptions for passkey authentication (sign-in).
 */
export function createAuthenticationOptions(
  challenge: string,
  rpId?: string,
  allowCredentialIds?: string[],
) {
  const config = getWebAuthnConfig();
  const effectiveRpId = rpId ?? config.rpId;

  return {
    challenge,
    rpId: effectiveRpId,
    allowCredentials: allowCredentialIds?.map((id) => ({
      id,
      type: 'public-key' as const,
    })),
    userVerification: 'preferred' as const,
    timeout: 60000,
  };
}

export interface RegistrationResponseJSON {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
}

/**
 * Converts a COSE public key Map into an SPKI PEM string using Node.js crypto.
 */
export function coseKeyToSpkiPem(coseKey: Map<unknown, unknown>): string {
  const kty = coseKey.get(1); // 1 = kty
  const alg = coseKey.get(3); // 3 = alg

  // kty: 2 = EC2 (e.g. ES256)
  if (kty === 2) {
    const crv = coseKey.get(-1); // -1 = crv (1 = P-256)
    const rawX = coseKey.get(-2);
    const rawY = coseKey.get(-3);
    const x = rawX ? Buffer.from(rawX as Uint8Array) : null;
    const y = rawY ? Buffer.from(rawY as Uint8Array) : null;

    if (crv !== 1 || !x || !y) {
      throw new Error('Unsupported EC2 curve or missing coordinates.');
    }

    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: x.toString('base64url'),
        y: y.toString('base64url'),
      },
      format: 'jwk',
    });

    return keyObject.export({ type: 'spki', format: 'pem' }) as string;
  }

  // kty: 3 = RSA (e.g. RS256)
  if (kty === 3) {
    const rawN = coseKey.get(-1);
    const rawE = coseKey.get(-2);
    const n = rawN ? Buffer.from(rawN as Uint8Array) : null;
    const e = rawE ? Buffer.from(rawE as Uint8Array) : null;

    if (!n || !e) {
      throw new Error('Missing RSA modulus or exponent.');
    }

    const keyObject = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: n.toString('base64url'),
        e: e.toString('base64url'),
      },
      format: 'jwk',
    });

    return keyObject.export({ type: 'spki', format: 'pem' }) as string;
  }

  throw new Error(
    `Unsupported COSE public key type (${String(kty)}) or algorithm (${String(alg)}).`,
  );
}

/**
 * Verifies WebAuthn registration response and returns credentialId, SPKI PEM public key, and counter.
 */
export async function verifyRegistrationResponse(params: {
  response: RegistrationResponseJSON;
  expectedChallenge: string;
  expectedOrigin?: string;
  expectedRpId?: string;
}): Promise<{ credentialId: string; publicKeyPem: string; counter: number }> {
  await Promise.resolve();
  const config = getWebAuthnConfig();
  const expectedOrigin = params.expectedOrigin ?? config.origin;
  const expectedRpId = params.expectedRpId ?? config.rpId;

  // 1. Parse clientDataJSON
  const clientDataBuf = Buffer.from(params.response.response.clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataBuf.toString('utf8')) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientData.type !== 'webauthn.create') {
    throw new Error(`Invalid registration clientData type: ${clientData.type}`);
  }

  if (clientData.challenge !== params.expectedChallenge) {
    throw new Error('WebAuthn challenge mismatch during registration.');
  }

  if (clientData.origin !== expectedOrigin) {
    throw new Error(`Origin mismatch: expected ${expectedOrigin}, got ${clientData.origin}`);
  }

  // 2. Parse attestationObject
  const attestationBuf = Buffer.from(params.response.response.attestationObject, 'base64url');
  const attestationMap = decodeCbor(attestationBuf) as Map<string, unknown>;
  const authDataRaw = attestationMap.get('authData');
  const authData = authDataRaw ? Buffer.from(authDataRaw as Uint8Array) : null;

  if (!authData || authData.length < 37) {
    throw new Error('Malformed authData in WebAuthn attestationObject.');
  }

  // Verify rpIdHash
  const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
  const actualRpIdHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpIdHash, actualRpIdHash)) {
    throw new Error('WebAuthn RP ID hash mismatch.');
  }

  // Verify User Present (UP) flag
  const flags = authData.readUInt8(32);
  if ((flags & 0x01) === 0) {
    throw new Error('User Present (UP) flag was not set by authenticator.');
  }

  // Verify Attested Credential Data (AT) flag
  if ((flags & 0x40) === 0) {
    throw new Error('Attested credential data was not provided in registration.');
  }

  const signCount = authData.readUInt32BE(33);

  // Extract Attested Credential Data
  // bytes 37..53: aaguid (16)
  // bytes 53..55: credIdLen (2)
  const credIdLen = authData.readUInt16BE(53);
  const credIdBytes = authData.subarray(55, 55 + credIdLen);
  const credentialId = credIdBytes.toString('base64url');

  // Remainder is COSE key
  const coseKeyBuf = authData.subarray(55 + credIdLen);
  const coseKeyMap = decodeCbor(coseKeyBuf) as Map<unknown, unknown>;
  const publicKeyPem = coseKeyToSpkiPem(coseKeyMap);

  return {
    credentialId,
    publicKeyPem,
    counter: signCount,
  };
}

export interface AuthenticationResponseJSON {
  id: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string;
  };
}

/**
 * Verifies WebAuthn authentication response against stored public key PEM and sign counter.
 */
export async function verifyAuthenticationResponse(params: {
  response: AuthenticationResponseJSON;
  publicKeyPem: string;
  prevCounter: number;
  expectedChallenge: string;
  expectedOrigin?: string;
  expectedRpId?: string;
}): Promise<{ verified: boolean; newCounter: number }> {
  await Promise.resolve();
  const config = getWebAuthnConfig();
  const expectedOrigin = params.expectedOrigin ?? config.origin;
  const expectedRpId = params.expectedRpId ?? config.rpId;

  // 1. Verify clientDataJSON
  const clientDataBuf = Buffer.from(params.response.response.clientDataJSON, 'base64url');
  const clientData = JSON.parse(clientDataBuf.toString('utf8')) as {
    type: string;
    challenge: string;
    origin: string;
  };

  if (clientData.type !== 'webauthn.get') {
    throw new Error(`Invalid authentication clientData type: ${clientData.type}`);
  }

  if (clientData.challenge !== params.expectedChallenge) {
    throw new Error('WebAuthn challenge mismatch during authentication.');
  }

  if (clientData.origin !== expectedOrigin) {
    throw new Error(`Origin mismatch: expected ${expectedOrigin}, got ${clientData.origin}`);
  }

  // 2. Verify authenticatorData
  const authData = Buffer.from(params.response.response.authenticatorData, 'base64url');
  if (authData.length < 37) {
    throw new Error('Malformed authenticatorData in WebAuthn authentication.');
  }

  const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest();
  const actualRpIdHash = authData.subarray(0, 32);
  if (!crypto.timingSafeEqual(expectedRpIdHash, actualRpIdHash)) {
    throw new Error('WebAuthn RP ID hash mismatch in authenticatorData.');
  }

  const flags = authData.readUInt8(32);
  if ((flags & 0x01) === 0) {
    throw new Error('User Present (UP) flag was not set during authentication.');
  }

  const signCount = authData.readUInt32BE(33);
  if (signCount > 0 && signCount <= params.prevCounter) {
    throw new Error(
      `Counter replay detected: authenticator counter ${signCount.toString()} <= ${params.prevCounter.toString()}`,
    );
  }

  // 3. Verify cryptographic signature
  const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const signature = Buffer.from(params.response.response.signature, 'base64url');

  const keyObject = crypto.createPublicKey(params.publicKeyPem);
  const isValidSig = crypto.verify('sha256', signedData, keyObject, signature);

  if (!isValidSig) {
    throw new Error('Cryptographic signature verification failed for passkey.');
  }

  return {
    verified: true,
    newCounter: signCount,
  };
}
