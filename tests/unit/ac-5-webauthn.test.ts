import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  getWebAuthnConfig,
  generateWebAuthnChallenge,
  createRegistrationOptions,
  createAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
  encodeCbor,
} from '@/server/auth/webauthn';

describe('AC-5: WebAuthn Passkeys Cryptography, Parsing and Verification', () => {
  const origin = 'http://localhost:3000';
  const rpId = 'localhost';

  it('AC-5: derives RP ID and Origin strictly from configured AUTH_URL', () => {
    const config = getWebAuthnConfig('http://localhost:3000');
    expect(config.rpId).toBe('localhost');
    expect(config.origin).toBe('http://localhost:3000');
    expect(config.rpName).toBe('Photo CRM');

    const prodConfig = getWebAuthnConfig('https://crm.example.com');
    expect(prodConfig.rpId).toBe('crm.example.com');
    expect(prodConfig.origin).toBe('https://crm.example.com');
  });

  it('AC-5: creates registration and authentication options with cryptographically secure challenge', () => {
    const challenge = generateWebAuthnChallenge();
    expect(challenge.length).toBeGreaterThanOrEqual(40); // 32 bytes base64url

    const user = {
      id: '01912345-6789-7abc-8def-0123456789ab',
      email: 'owner@example.com',
      name: 'Studio Owner',
    };

    const regOpts = createRegistrationOptions(user, challenge, rpId, 'Photo CRM');
    expect(regOpts.challenge).toBe(challenge);
    expect(regOpts.rp.id).toBe(rpId);
    expect(regOpts.user.name).toBe('owner@example.com');
    expect(regOpts.pubKeyCredParams).toEqual([
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ]);

    const authOpts = createAuthenticationOptions(challenge, rpId);
    expect(authOpts.challenge).toBe(challenge);
    expect(authOpts.rpId).toBe(rpId);
  });

  it('AC-5: verifies WebAuthn registration response and extracts public key PEM', async () => {
    const challenge = generateWebAuthnChallenge();
    const { publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });

    const jwk = publicKey.export({ format: 'jwk' });
    const x = Buffer.from(jwk.x ?? '', 'base64url');
    const y = Buffer.from(jwk.y ?? '', 'base64url');

    // Build COSE key map (alg -7 ES256, crv 1 P-256)
    const coseKeyMap = new Map<number, unknown>([
      [1, 2], // kty: 2 (EC2)
      [3, -7], // alg: -7 (ES256)
      [-1, 1], // crv: 1 (P-256)
      [-2, x], // x coordinate
      [-3, y], // y coordinate
    ]);
    const coseKeyBytes = encodeCbor(coseKeyMap);

    // Build authData
    const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
    const flags = 0x41; // UP (bit 0) | AT (bit 6)
    const aaguid = Buffer.alloc(16);
    const credentialId = Buffer.from('test-credential-id-12345');
    const credIdLen = Buffer.alloc(2);
    credIdLen.writeUInt16BE(credentialId.length);

    const authData = Buffer.concat([
      rpIdHash,
      Buffer.from([flags]),
      Buffer.alloc(4), // signCount = 0
      aaguid,
      credIdLen,
      credentialId,
      coseKeyBytes,
    ]);

    const attestationMap = new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]);
    const attestationObject = encodeCbor(attestationMap);

    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin,
      }),
    );

    const result = await verifyRegistrationResponse({
      response: {
        id: credentialId.toString('base64url'),
        rawId: credentialId.toString('base64url'),
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          attestationObject: attestationObject.toString('base64url'),
        },
      },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRpId: rpId,
    });

    expect(result.credentialId).toBe(credentialId.toString('base64url'));
    expect(result.counter).toBe(0);
    expect(result.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----');
    expect(result.publicKeyPem).toContain('-----END PUBLIC KEY-----');
  });

  it('AC-5: verifies WebAuthn authentication response and detects counter replay', async () => {
    const challenge = generateWebAuthnChallenge();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;

    const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
    const flags = 0x01; // UP (User Present)
    const signCountBuf = Buffer.alloc(4);
    signCountBuf.writeUInt32BE(5); // new counter = 5

    const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags]), signCountBuf]);

    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge,
        origin,
      }),
    );

    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
    const signedData = Buffer.concat([authenticatorData, clientDataHash]);
    const signature = crypto.sign('sha256', signedData, privateKey);

    // 1. Valid authentication
    const authResult = await verifyAuthenticationResponse({
      response: {
        id: 'test-credential-id',
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authenticatorData.toString('base64url'),
          signature: signature.toString('base64url'),
        },
      },
      publicKeyPem,
      prevCounter: 2, // 5 > 2 -> valid!
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRpId: rpId,
    });

    expect(authResult.verified).toBe(true);
    expect(authResult.newCounter).toBe(5);

    // 2. Replayed counter (counter 4 <= prevCounter 5) must fail
    signCountBuf.writeUInt32BE(4);
    const replayedAuthData = Buffer.concat([rpIdHash, Buffer.from([flags]), signCountBuf]);
    const replayedSignedData = Buffer.concat([replayedAuthData, clientDataHash]);
    const replayedSig = crypto.sign('sha256', replayedSignedData, privateKey);

    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'test-credential-id',
          response: {
            clientDataJSON: clientDataJSON.toString('base64url'),
            authenticatorData: replayedAuthData.toString('base64url'),
            signature: replayedSig.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 5,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRpId: rpId,
      }),
    ).rejects.toThrow('Counter replay');

    // 3. Mismatched origin must fail
    await expect(
      verifyAuthenticationResponse({
        response: {
          id: 'test-credential-id',
          response: {
            clientDataJSON: clientDataJSON.toString('base64url'),
            authenticatorData: authenticatorData.toString('base64url'),
            signature: signature.toString('base64url'),
          },
        },
        publicKeyPem,
        prevCounter: 2,
        expectedChallenge: challenge,
        expectedOrigin: 'https://attacker.example.com',
        expectedRpId: rpId,
      }),
    ).rejects.toThrow('Origin mismatch');
  });
});
