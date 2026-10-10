import { describe, it, expect, beforeEach } from 'vitest';
import { getMailTransporter, setTestTransporter, sendEmail } from '@/server/auth/email';
import type { Transporter } from 'nodemailer';

describe('Email transporter and sending service', () => {
  beforeEach(() => {
    setTestTransporter(null);
  });

  it('initializes and returns a nodemailer transporter', () => {
    const transporter = getMailTransporter();
    expect(transporter).toBeDefined();
    expect(typeof transporter.sendMail).toBe('function');
  });

  it('allows overriding the global transporter for tests', async () => {
    const sentMails: unknown[] = [];
    const mockTransporter = {
      sendMail: (options: unknown) => {
        sentMails.push(options);
        return Promise.resolve({ messageId: 'test-msg-123' });
      },
    } as unknown as Transporter;

    setTestTransporter(mockTransporter);
    expect(getMailTransporter()).toBe(mockTransporter);

    await sendEmail({
      to: 'client@example.com',
      subject: 'Welcome',
      text: 'Hello world',
    });

    expect(sentMails.length).toBe(1);
    expect((sentMails[0] as { to: string }).to).toBe('client@example.com');
  });

  it('uses explicit transporter when passed in sendEmail options', async () => {
    const customSent: unknown[] = [];
    const customTransporter = {
      sendMail: (options: unknown) => {
        customSent.push(options);
        return Promise.resolve({ messageId: 'custom-123' });
      },
    } as unknown as Transporter;

    await sendEmail({
      from: 'custom-from@example.com',
      to: 'recipient@example.com',
      subject: 'Custom Subject',
      text: 'Custom Body',
      transporter: customTransporter,
    });

    expect(customSent.length).toBe(1);
    expect((customSent[0] as { from: string }).from).toBe('custom-from@example.com');
  });
});
