import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn utility', () => {
  it('combines class names correctly', () => {
    expect(cn('class1', 'class2')).toBe('class1 class2');
  });

  it('handles conditional and falsy classes', () => {
    const isHidden = Boolean(process.env.NON_EXISTENT);
    expect(cn('class1', isHidden && 'class2', false, null, undefined, 'class3')).toBe(
      'class1 class3',
    );
  });

  it('merges tailwind classes resolving conflicts', () => {
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
  });
});
