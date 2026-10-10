import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let mockIsPending = false;
let mockStateQueue: unknown[] = [];

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useTransition: () => [
      mockIsPending,
      (fn: () => void | Promise<void>) => {
        void fn();
      },
    ],
    useState: <T,>(initial: T): [T, (val: T) => void] => {
      if (mockStateQueue.length > 0) {
        const val = mockStateQueue.shift() as T;
        return [val, vi.fn()];
      }
      return actual.useState(initial);
    },
  };
});

const mockPush = vi.fn();
const mockRefresh = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `translated-${key}`,
}));

const mockSetupOwnerAction = vi.fn();
const mockSignInAction = vi.fn();
const mockRequestPasswordResetAction = vi.fn();
const mockResetPasswordAction = vi.fn();

vi.mock('@/server/auth/actions', () => ({
  setupOwnerAction: (...args: unknown[]): unknown => mockSetupOwnerAction(...args),
  signInAction: (...args: unknown[]): unknown => mockSignInAction(...args),
  requestPasswordResetAction: (...args: unknown[]): unknown =>
    mockRequestPasswordResetAction(...args),
  resetPasswordAction: (...args: unknown[]): unknown => mockResetPasswordAction(...args),
}));

import { SetupForm } from '@/components/auth/setup-form';
import { SignInForm, sanitizeCallbackUrl } from '@/components/auth/sign-in-form';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { VerifyEmailView } from '@/components/auth/verify-email-view';

interface FormProps {
  onSubmit: (e: { preventDefault: () => void }) => Promise<void> | void;
}

interface InputProps {
  onChange?: (e: { target: { value: string } }) => void;
}

function findFormProps(element: React.ReactElement): FormProps | undefined {
  let found: FormProps | undefined;
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (
        node.type === 'form' &&
        typeof (node.props as Record<string, unknown>).onSubmit === 'function'
      ) {
        found = node.props as FormProps;
        return;
      }
      const props = node.props as { children?: unknown };
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return found;
}

function findInputs(element: React.ReactElement): InputProps[] {
  const inputs: InputProps[] = [];
  function traverse(node: unknown): void {
    if (!node || typeof node !== 'object') return;
    if (React.isValidElement(node)) {
      if (node.type === 'input') {
        inputs.push(node.props as InputProps);
      }
      const props = node.props as { children?: unknown };
      if (props.children) {
        traverse(props.children);
      }
    } else if (Array.isArray(node)) {
      for (const item of node) {
        traverse(item);
      }
    }
  }
  traverse(element);
  return inputs;
}

describe('Auth Client Components and Form Submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockIsPending = false;
    mockStateQueue = [];
  });

  describe('SetupForm', () => {
    it('renders setup form with all input fields and descriptions', () => {
      const html = renderToStaticMarkup(<SetupForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="setup-form"');
      expect(html).toContain('data-testid="setup-token-input"');
      expect(html).toContain('data-testid="name-input"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('data-testid="password-input"');
    });

    it('executes onSubmit handler and triggers router navigation on success', async () => {
      mockSetupOwnerAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      expect(formProps).toBeDefined();

      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSetupOwnerAction).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/en');
    });

    it('executes onSubmit handler and sets error on failure', async () => {
      mockSetupOwnerAction.mockResolvedValueOnce({
        success: false,
        error: 'Setup token invalid.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSetupOwnerAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = SetupForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'test-value' } });
      }
    });

    it('renders setup form with error alert and pending submit button', () => {
      mockStateQueue = ['', '', '', '', 'Setup token invalid'];
      mockIsPending = true;
      const html = renderToStaticMarkup(<SetupForm locale="en" />);
      expect(html).toContain('data-testid="setup-error"');
      expect(html).toContain('Setup token invalid');
      expect(html).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(html).toContain('text-red-950');
      expect(html).toContain('id="setup-error-msg"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="setup-error-msg"');
    });
  });

  describe('SignInForm', () => {
    it('renders sign-in form with email and password inputs and forgot password link', () => {
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="signin-form"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('data-testid="password-input"');
      expect(html).toContain('/forgot-password');
    });

    it('executes signInAction and navigates on success', async () => {
      mockSignInAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/en');
    });

    it('handles sign in failure', async () => {
      mockSignInAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid email or password.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers in SignInForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'user@example.com' } });
      }
    });

    it('renders sign-in form with error alert and pending submit button', () => {
      mockStateQueue = ['', '', 'Invalid email or password'];
      mockIsPending = true;
      const html = renderToStaticMarkup(<SignInForm locale="en" />);
      expect(html).toContain('data-testid="signin-error"');
      expect(html).toContain('Invalid email or password');
      expect(html).toContain('translated-submitting');
      // I1-U01: High contrast classes
      expect(html).toContain('text-red-950');
      expect(html).toContain('bg-red-100');
      // I1-U02: Error linkage with aria-invalid and aria-describedby
      expect(html).toContain('id="signin-error-msg"');
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="signin-error-msg"');
    });

    it('I1-S03: sanitizeCallbackUrl rejects open redirects and external schemes', () => {
      expect(sanitizeCallbackUrl('https://evil.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('http://attacker.com/steal', 'de')).toBe('/de');
      expect(sanitizeCallbackUrl('//malicious.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('javascript:alert(1)', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl('/\\evil.com', 'en')).toBe('/en');
      expect(sanitizeCallbackUrl(null, 'en')).toBe('/en');
      expect(sanitizeCallbackUrl(undefined, 'de')).toBe('/de');
      expect(sanitizeCallbackUrl('', 'en')).toBe('/en');

      // Valid relative paths must be accepted
      expect(sanitizeCallbackUrl('/en/dashboard', 'en')).toBe('/en/dashboard');
      expect(sanitizeCallbackUrl('/de/settings', 'de')).toBe('/de/settings');
    });

    it('I1-S03: SignInForm sanitizes open redirect callbackUrl upon successful sign-in', async () => {
      mockSearchParams = new URLSearchParams('callbackUrl=https://attacker.com/phish');
      mockSignInAction.mockResolvedValueOnce({
        success: true,
        data: { user: { id: 'u1', email: 'owner@example.com', name: 'Owner' } },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = SignInForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockSignInAction).toHaveBeenCalled();
      // Must NOT redirect to https://attacker.com
      expect(mockPush).toHaveBeenCalledWith('/en');
      mockSearchParams = new URLSearchParams();
    });
  });

  describe('ForgotPasswordForm', () => {
    it('renders forgot-password form with email input and submit button', () => {
      const html = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="forgot-password-form"');
      expect(html).toContain('data-testid="email-input"');
      expect(html).toContain('/sign-in');
    });

    it('executes requestPasswordResetAction and updates status message', async () => {
      mockRequestPasswordResetAction.mockResolvedValueOnce({
        success: true,
        data: { message: 'Reset email dispatched.' },
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockRequestPasswordResetAction).toHaveBeenCalled();
    });

    it('handles requestPasswordResetAction failure', async () => {
      mockSearchParams = new URLSearchParams('email=preset@example.com');
      mockRequestPasswordResetAction.mockResolvedValueOnce({
        success: false,
        error: 'Rate limit exceeded.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockRequestPasswordResetAction).toHaveBeenCalled();
    });

    it('triggers email input onChange in ForgotPasswordForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = ForgotPasswordForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'forgot@example.com' } });
      }
    });

    it('renders forgot-password form with status message, error alert and pending submit button', () => {
      mockStateQueue = ['', 'Instructions dispatched', null];
      mockIsPending = false;
      const htmlStatus = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(htmlStatus).toContain('data-testid="forgot-password-feedback"');
      expect(htmlStatus).toContain('Instructions dispatched');

      mockStateQueue = ['', null, 'Rate limit reached'];
      mockIsPending = true;
      const htmlError = renderToStaticMarkup(<ForgotPasswordForm locale="en" />);
      expect(htmlError).toContain('data-testid="forgot-password-error"');
      expect(htmlError).toContain('Rate limit reached');
      expect(htmlError).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(htmlError).toContain('text-red-950');
      expect(htmlError).toContain('id="forgot-password-error-msg"');
      expect(htmlError).toContain('aria-invalid="true"');
      expect(htmlError).toContain('aria-describedby="forgot-password-error-msg"');
    });
  });

  describe('ResetPasswordForm', () => {
    it('renders reset-password form with new password input', () => {
      mockSearchParams = new URLSearchParams('token=test-token-123&email=user@example.com');
      const html = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="reset-password-form"');
      expect(html).toContain('data-testid="password-input"');
    });

    it('executes resetPasswordAction on submit and handles success', async () => {
      mockSearchParams = new URLSearchParams('token=valid-token&email=user@example.com');
      mockResetPasswordAction.mockResolvedValueOnce({
        success: true,
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockResetPasswordAction).toHaveBeenCalled();
    });

    it('handles password mismatch and reset failure', async () => {
      mockSearchParams = new URLSearchParams('token=valid-token&email=user@example.com');
      mockResetPasswordAction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid or expired token.',
      });

      let formProps: FormProps | undefined;
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        formProps = findFormProps(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      await formProps?.onSubmit({ preventDefault: () => undefined });
      expect(mockResetPasswordAction).toHaveBeenCalled();
    });

    it('triggers input onChange handlers in ResetPasswordForm', () => {
      let inputs: InputProps[] = [];
      function Wrapper() {
        const tree = ResetPasswordForm({ locale: 'en' });
        inputs = findInputs(tree);
        return <div>{tree}</div>;
      }

      renderToStaticMarkup(<Wrapper />);
      for (const input of inputs) {
        input.onChange?.({ target: { value: 'password-val' } });
      }
    });

    it('renders reset-password form with error alert, success view and pending submit button', () => {
      mockStateQueue = ['', '', false, 'Tokens do not match'];
      mockIsPending = true;
      const htmlError = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(htmlError).toContain('data-testid="reset-password-error"');
      expect(htmlError).toContain('Tokens do not match');
      expect(htmlError).toContain('translated-submitting');
      // I1-U01 & I1-U02
      expect(htmlError).toContain('text-red-950');
      expect(htmlError).toContain('id="reset-password-error-msg"');
      expect(htmlError).toContain('aria-invalid="true"');
      expect(htmlError).toContain('aria-describedby="reset-password-error-msg"');

      mockStateQueue = ['', '', true, null];
      mockIsPending = false;
      const htmlSuccess = renderToStaticMarkup(<ResetPasswordForm locale="en" />);
      expect(htmlSuccess).toContain('data-testid="reset-password-success"');
      expect(htmlSuccess).toContain('translated-successTitle');
    });
  });

  describe('VerifyEmailView', () => {
    it('renders verify email confirmation view and sign in link', () => {
      const html = renderToStaticMarkup(<VerifyEmailView locale="en" />);
      expect(html).toContain('translated-title');
      expect(html).toContain('data-testid="verify-email-title"');
      expect(html).toContain('/sign-in');
    });
  });
});
