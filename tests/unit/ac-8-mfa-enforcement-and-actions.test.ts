import { describe, it, expect, vi } from 'vitest';
import crypto from 'node:crypto';
import { checkMfaEnforcement } from '@/server/auth/mfa-enforcement';
import { base64UrlToBuffer, bufferToBase64Url, isWebAuthnSupported } from '@/lib/webauthn-client';
import {
  coseKeyToSpkiPem,
  encodeCbor,
  decodeCbor,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  createRegistrationOptions,
  createAuthenticationOptions,
} from '@/server/auth/webauthn';
import type { DbClient } from '@/server/db/client';

vi.mock('server-only', () => ({}));

describe('WebAuthn Client utilities', () => {
  it('converts between ArrayBuffer and base64url deterministically', () => {
    const raw = Buffer.from('hello webauthn world!', 'utf8');
    const b64url = bufferToBase64Url(raw);
    expect(typeof b64url).toBe('string');
    expect(b64url).not.toContain('+');
    expect(b64url).not.toContain('/');
    expect(b64url).not.toContain('=');

    const roundtrip = base64UrlToBuffer(b64url);
    expect(Buffer.from(roundtrip).toString('utf8')).toBe('hello webauthn world!');
  });

  it('handles empty and padded base64url buffers', () => {
    const emptyBuf = new ArrayBuffer(0);
    const emptyB64 = bufferToBase64Url(emptyBuf);
    expect(emptyB64).toBe('');
    expect(new Uint8Array(base64UrlToBuffer('')).length).toBe(0);

    const binary = Buffer.from([0, 255, 128, 64]);
    const encoded = bufferToBase64Url(binary);
    const decoded = Buffer.from(base64UrlToBuffer(encoded));
    expect(decoded.equals(binary)).toBe(true);
  });

  it('checks isWebAuthnSupported gracefully in test environment', () => {
    expect(typeof isWebAuthnSupported()).toBe('boolean');
  });
});

describe('AC-8: checkMfaEnforcement service', () => {
  it('returns null if session token is missing or session is not found in database', async () => {
    const res1 = await checkMfaEnforcement('en', '/en/settings', null);
    expect(res1).toBeNull();

    const mockClient = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    const res2 = await checkMfaEnforcement('en', '/en/settings', 'non-existent-token', mockClient);
    expect(res2).toBeNull();
  });

  it('returns null if current route is exempt from forced redirection', async () => {
    const exemptPaths = [
      '/en/settings/security',
      '/en/sign-in',
      '/en/setup',
      '/en/forgot-password',
      '/en/reset-password',
    ];

    for (const path of exemptPaths) {
      const res = await checkMfaEnforcement('en', path, 'valid-token');
      expect(res).toBeNull();
    }
  });

  it('returns null if session verification fails or studio settings mfa_required is false', async () => {
    const mockClient = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () => Promise.resolve([]),
            }),
          }),
        }),
      }),
    } as unknown as DbClient;

    const res = await checkMfaEnforcement('en', '/en/clients', 'unverified-token', mockClient);
    expect(res).toBeNull();
  });

  function createMockEnforcementClient(config: {
    sessionValid?: boolean;
    mfaRequired?: boolean;
    mfaPostponedUntil?: Date | null;
    hasTotp?: boolean;
    hasPasskey?: boolean;
  }) {
    let totpChecked = false;
    return {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve(
                  config.sessionValid
                    ? [
                        {
                          session: { id: 's1', userId: 'u1' },
                          user: { id: 'u1', email: 'owner@example.com' },
                        },
                      ]
                    : [],
                ),
            }),
          }),
          limit: () =>
            Promise.resolve([
              {
                id: 'st-1',
                mfa_required: config.mfaRequired ?? false,
                mfa_postponed_until: config.mfaPostponedUntil ?? null,
              },
            ]),
          where: () => ({
            limit: () => {
              if (!totpChecked) {
                totpChecked = true;
                return Promise.resolve(config.hasTotp ? [{ id: 'totp-1' }] : []);
              }
              return Promise.resolve(config.hasPasskey ? [{ id: 'passkey-1' }] : []);
            },
          }),
        }),
      }),
    } as unknown as DbClient;
  }

  it('returns null when studio settings mfa_required is false', async () => {
    const client = createMockEnforcementClient({
      sessionValid: true,
      mfaRequired: false,
    });
    const res = await checkMfaEnforcement('en', '/en/clients', 'valid-token', client);
    expect(res).toBeNull();
  });

  it('returns null when postponement has not expired', async () => {
    const client = createMockEnforcementClient({
      sessionValid: true,
      mfaRequired: true,
      mfaPostponedUntil: new Date(Date.now() + 60000),
    });
    const res = await checkMfaEnforcement('en', '/en/clients', 'valid-token', client);
    expect(res).toBeNull();
  });

  it('returns null when owner has active TOTP configured', async () => {
    const client = createMockEnforcementClient({
      sessionValid: true,
      mfaRequired: true,
      mfaPostponedUntil: null,
      hasTotp: true,
    });
    const res = await checkMfaEnforcement('en', '/en/clients', 'valid-token', client);
    expect(res).toBeNull();
  });

  it('returns null when owner has registered passkey', async () => {
    const client = createMockEnforcementClient({
      sessionValid: true,
      mfaRequired: true,
      mfaPostponedUntil: null,
      hasTotp: false,
      hasPasskey: true,
    });
    const res = await checkMfaEnforcement('en', '/en/clients', 'valid-token', client);
    expect(res).toBeNull();
  });

  it('returns redirection URL to security settings with mfa_enforced=1 when user has no MFA and postponement expired', async () => {
    const client = createMockEnforcementClient({
      sessionValid: true,
      mfaRequired: true,
      mfaPostponedUntil: new Date(Date.now() - 1000),
      hasTotp: false,
      hasPasskey: false,
    });
    const res = await checkMfaEnforcement('de', '/de/dashboard', 'valid-token', client);
    expect(res).toBe('/de/settings/security?mfa_enforced=1');
  });
});

describe('AC-5: WebAuthn verification error cases and cryptographic checks', () => {
  it('createRegistrationOptions and createAuthenticationOptions set default rpId', () => {
    const reg = createRegistrationOptions(
      { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
      'test-challenge',
    );
    expect(reg.rp.id).toBeDefined();
    expect(reg.pubKeyCredParams.length).toBeGreaterThan(0);

    const auth = createAuthenticationOptions('auth-challenge');
    expect(auth.challenge).toBe('auth-challenge');
    expect(auth.rpId).toBeDefined();
  });

  it('coseKeyToSpkiPem throws for unsupported curves or missing coords', () => {
    const invalidMap = new Map<number, unknown>([
      [1, 2], // EC2
      [3, -7],
      [-1, 999], // invalid curve
    ]);
    expect(() => coseKeyToSpkiPem(invalidMap)).toThrow('Unsupported EC2 curve');

    const invalidRsa = new Map<number, unknown>([
      [1, 3], // RSA
    ]);
    expect(() => coseKeyToSpkiPem(invalidRsa)).toThrow('Missing RSA modulus');

    const unknownKty = new Map<number, unknown>([[1, 99]]);
    expect(() => coseKeyToSpkiPem(unknownKty)).toThrow('Unsupported COSE public key type');
  });

  it('converts RSA COSE key to SPKI PEM format', () => {
    const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    const coseRsa = new Map<number, unknown>([
      [1, 3], // RSA
      [3, -257], // RS256
      [-1, Buffer.from(jwk.n ?? '', 'base64url')],
      [-2, Buffer.from(jwk.e ?? '', 'base64url')],
    ]);

    const pem = coseKeyToSpkiPem(coseRsa);
    expect(pem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pem).toContain('-----END PUBLIC KEY-----');
  });

  it('verifyRegistrationResponse rejects clientData type mismatch, challenge mismatch, or origin mismatch', async () => {
    const baseClientData = {
      type: 'webauthn.get', // wrong type for registration
      challenge: 'expected-challenge',
      origin: 'http://localhost:3000',
    };

    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify(baseClientData)).toString('base64url'),
            attestationObject: 'empty',
          },
        },
        expectedChallenge: 'expected-challenge',
      }),
    ).rejects.toThrow('Invalid registration clientData type');

    const mismatchChallenge = {
      type: 'webauthn.create',
      challenge: 'wrong-challenge',
      origin: 'http://localhost:3000',
    };

    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify(mismatchChallenge)).toString('base64url'),
            attestationObject: 'empty',
          },
        },
        expectedChallenge: 'expected-challenge',
      }),
    ).rejects.toThrow('challenge mismatch');

    const mismatchOrigin = {
      type: 'webauthn.create',
      challenge: 'expected-challenge',
      origin: 'https://evil.com',
    };

    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify(mismatchOrigin)).toString('base64url'),
            attestationObject: 'empty',
          },
        },
        expectedChallenge: 'expected-challenge',
        expectedOrigin: 'http://localhost:3000',
      }),
    ).rejects.toThrow('Origin mismatch');
  });

  it('verifyAuthenticationResponse detects counter replay and signature mismatches', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const challenge = 'valid-challenge';
    const clientData = {
      type: 'webauthn.get',
      challenge,
      origin: 'http://localhost:3000',
    };
    const clientDataBuf = Buffer.from(JSON.stringify(clientData));
    const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();

    const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
    const flags = Buffer.from([0x01]); // UP
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(5); // counter = 5
    const authData = Buffer.concat([rpIdHash, flags, signCountBuf]);

    // Sign with valid private key
    const signedData = Buffer.concat([authData, clientDataHash]);
    const validSignature = crypto.sign('sha256', signedData, privateKey);

    // 1. Success case
    const authResult = await verifyAuthenticationResponse({
      response: {
        id: 'cred-1',
        response: {
          clientDataJSON: clientDataBuf.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: validSignature.toString('base64url'),
        },
      },
      publicKeyPem,
      prevCounter: 4,
      expectedChallenge: challenge,
      expectedOrigin: 'http://localhost:3000',
      expectedRpId: 'localhost',
    });

    expect(authResult.verified).toBe(true);
    expect(authResult.newCounter).toBe(5);

    // 2. Replay detected: counter <= prevCounter
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: clientDataBuf.toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: validSignature.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 5,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('Counter replay detected');

    // 3. User Present flag missing
    const noUpFlags = Buffer.from([0x00]);
    const noUpAuthData = Buffer.concat([rpIdHash, noUpFlags, signCountBuf]);
    const noUpSigned = Buffer.concat([noUpAuthData, clientDataHash]);
    const noUpSig = crypto.sign('sha256', noUpSigned, privateKey);

    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: clientDataBuf.toString('base64url'),
            authenticatorData: noUpAuthData.toString('base64url'),
            signature: noUpSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('User Present (UP) flag was not set');

    // 4. authData too short (< 37)
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: clientDataBuf.toString('base64url'),
            authenticatorData: Buffer.alloc(10).toString('base64url'),
            signature: validSignature.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('Malformed authenticatorData');

    // 5. RP ID mismatch
    const badRpIdHash = crypto.createHash('sha256').update('evil.com').digest();
    const badRpAuthData = Buffer.concat([badRpIdHash, flags, signCountBuf]);
    const badRpSigned = Buffer.concat([badRpAuthData, clientDataHash]);
    const badRpSig = crypto.sign('sha256', badRpSigned, privateKey);
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: clientDataBuf.toString('base64url'),
            authenticatorData: badRpAuthData.toString('base64url'),
            signature: badRpSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('WebAuthn RP ID hash mismatch');

    // 6. Invalid cryptographic signature
    const corruptSig = Buffer.from(validSignature);
    const firstByte = corruptSig[0] ?? 0;
    corruptSig[0] = firstByte ^ 0xff;
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: clientDataBuf.toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: corruptSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('signature verification failed');

    // 7. ClientData type mismatch in authentication
    const badAuthType = {
      type: 'webauthn.bad',
      challenge,
      origin: 'http://localhost:3000',
    };
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: Buffer.from(JSON.stringify(badAuthType)).toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: validSignature.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
      }),
    ).rejects.toThrow('Invalid authentication clientData type');
  });

  it('verifyRegistrationResponse checks authData length, rpId, and UP/AT flags', async () => {
    const validClientData = {
      type: 'webauthn.create',
      challenge: 'expected-challenge',
      origin: 'http://localhost:3000',
    };
    const clientDataB64 = Buffer.from(JSON.stringify(validClientData)).toString('base64url');
    const expectedRpHash = crypto.createHash('sha256').update('localhost').digest();

    // 1. Short authData in attestationObject
    const shortAttestation = encodeCbor(new Map([['authData', Buffer.alloc(10)]]));
    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: clientDataB64,
            attestationObject: shortAttestation.toString('base64url'),
          },
        },
        expectedChallenge: 'expected-challenge',
        expectedOrigin: 'http://localhost:3000',
      }),
    ).rejects.toThrow('Malformed authData');

    // 2. RP ID mismatch in registration
    const evilRpIdHash = crypto.createHash('sha256').update('evil.com').digest();
    const badRpRegAuthData = Buffer.concat([
      evilRpIdHash,
      Buffer.from([0x41]), // UP + AT
      Buffer.alloc(4),
      Buffer.alloc(16),
      Buffer.from([0x00, 0x01]),
      Buffer.from([0x01]),
      Buffer.alloc(10),
    ]);
    const badRpAttestation = encodeCbor(new Map([['authData', badRpRegAuthData]]));
    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: clientDataB64,
            attestationObject: badRpAttestation.toString('base64url'),
          },
        },
        expectedChallenge: 'expected-challenge',
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('RP ID hash mismatch');

    // 3. UP flag missing in registration
    const noUpRegAuthData = Buffer.concat([
      expectedRpHash,
      Buffer.from([0x40]), // AT only, no UP
      Buffer.alloc(4),
      Buffer.alloc(16),
      Buffer.from([0x00, 0x01]),
      Buffer.from([0x01]),
      Buffer.alloc(10),
    ]);
    const noUpAttestation = encodeCbor(new Map([['authData', noUpRegAuthData]]));
    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: clientDataB64,
            attestationObject: noUpAttestation.toString('base64url'),
          },
        },
        expectedChallenge: 'expected-challenge',
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('User Present (UP) flag was not set');

    // 4. AT flag missing in registration
    const noAtRegAuthData = Buffer.concat([
      expectedRpHash,
      Buffer.from([0x01]), // UP only, no AT
      Buffer.alloc(4),
      Buffer.alloc(16),
      Buffer.from([0x00, 0x01]),
      Buffer.from([0x01]),
      Buffer.alloc(10),
    ]);
    const noAtAttestation = encodeCbor(new Map([['authData', noAtRegAuthData]]));
    await expect(
      verifyRegistrationResponse({
        response: {
          id: 'test-id',
          rawId: 'test-id',
          response: {
            clientDataJSON: clientDataB64,
            attestationObject: noAtAttestation.toString('base64url'),
          },
        },
        expectedChallenge: 'expected-challenge',
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('Attested credential data was not provided');
  });

  it('covers createRegistrationOptions and createAuthenticationOptions parameter branches', () => {
    const regOptions1 = createRegistrationOptions(
      { id: 'user-123', email: 'test@example.com', name: 'Test User' },
      'challenge-123',
    );
    expect(regOptions1.rp.name).toBe('Ownlight');
    expect(regOptions1.challenge).toBe('challenge-123');

    const regOptions2 = createRegistrationOptions(
      { id: 'user-123', email: 'test@example.com', name: 'Test User' },
      'challenge-123',
      'custom.local',
      'Custom Studio',
    );
    expect(regOptions2.rp.id).toBe('custom.local');
    expect(regOptions2.rp.name).toBe('Custom Studio');

    const authOptions1 = createAuthenticationOptions('auth-challenge-123');
    expect(authOptions1.challenge).toBe('auth-challenge-123');
    expect(authOptions1.allowCredentials).toBeUndefined();

    const authOptions2 = createAuthenticationOptions('auth-challenge-123', 'custom.local', [
      'cred-1',
      'cred-2',
    ]);
    expect(authOptions2.rpId).toBe('custom.local');
    expect(authOptions2.allowCredentials?.length).toBe(2);
  });

  it('covers decodeCbor array and unsupported major types', () => {
    // Array in CBOR: 0x82 (array of 2 items: 1, 2)
    const arrayCbor = Buffer.from([0x82, 0x01, 0x02]);
    const decodedArray = decodeCbor(arrayCbor) as unknown[];
    expect(Array.isArray(decodedArray)).toBe(true);
    expect(decodedArray).toEqual([1, 2]);

    // Unsupported major type (e.g. 0xe0 = major type 7 / simple/float)
    const unsupportedCbor = Buffer.from([0xe0]);
    expect(() => decodeCbor(unsupportedCbor)).toThrow(/Unsupported/);
  });

  it('covers verifyAuthenticationResponse challenge and origin mismatches', async () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const challenge = 'expected-challenge';

    const authData = Buffer.concat([
      crypto.createHash('sha256').update('localhost').digest(),
      Buffer.from([0x01]),
      Buffer.from([0x00, 0x00, 0x00, 0x01]),
    ]);

    // Challenge mismatch
    const badChallengeClientData = {
      type: 'webauthn.get',
      challenge: 'wrong-challenge',
      origin: 'http://localhost:3000',
    };
    const badChallengeBuf = Buffer.from(JSON.stringify(badChallengeClientData));
    const badChallengeSig = crypto.sign(
      'sha256',
      Buffer.concat([authData, crypto.createHash('sha256').update(badChallengeBuf).digest()]),
      privateKey,
    );

    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: badChallengeBuf.toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: badChallengeSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('challenge mismatch');

    // Origin mismatch
    const badOriginClientData = {
      type: 'webauthn.get',
      challenge,
      origin: 'http://evil.com',
    };
    const badOriginBuf = Buffer.from(JSON.stringify(badOriginClientData));
    const badOriginSig = crypto.sign(
      'sha256',
      Buffer.concat([authData, crypto.createHash('sha256').update(badOriginBuf).digest()]),
      privateKey,
    );

    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'cred-1',
          response: {
            clientDataJSON: badOriginBuf.toString('base64url'),
            authenticatorData: authData.toString('base64url'),
            signature: badOriginSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 0,
        expectedChallenge: challenge,
        expectedOrigin: 'http://localhost:3000',
        expectedRpId: 'localhost',
      }),
    ).rejects.toThrow('Origin mismatch');
  });
});
