import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@radix-ui/react-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dialog')>();
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dialog-portal">{children}</div>
    ),
  };
});

vi.mock('@radix-ui/react-dropdown-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dropdown-menu')>();
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="menu-portal">{children}</div>
    ),
  };
});

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

describe('UI Primitives Unit Tests', () => {
  it('renders Button with variants and asChild', () => {
    const defaultBtn = renderToStaticMarkup(<Button>Click</Button>);
    expect(defaultBtn).toContain('Click');

    const destructiveBtn = renderToStaticMarkup(
      <Button variant="destructive" size="lg">
        Delete
      </Button>,
    );
    expect(destructiveBtn).toContain('Delete');

    const outlineBtn = renderToStaticMarkup(
      <Button variant="outline" size="sm">
        Outline
      </Button>,
    );
    expect(outlineBtn).toContain('Outline');

    const secondaryBtn = renderToStaticMarkup(
      <Button variant="secondary" size="icon">
        Secondary
      </Button>,
    );
    expect(secondaryBtn).toContain('Secondary');

    const ghostBtn = renderToStaticMarkup(<Button variant="ghost">Ghost</Button>);
    expect(ghostBtn).toContain('Ghost');

    const linkBtn = renderToStaticMarkup(<Button variant="link">Link</Button>);
    expect(linkBtn).toContain('Link');

    const asChildBtn = renderToStaticMarkup(
      <Button asChild>
        <a href="#test">Link</a>
      </Button>,
    );
    expect(asChildBtn).toContain('href="#test"');
  });

  it('renders Avatar components', () => {
    const avatar = renderToStaticMarkup(
      <Avatar>
        <AvatarImage src="/avatar.jpg" alt="User" />
        <AvatarFallback>JD</AvatarFallback>
      </Avatar>,
    );
    expect(avatar).toContain('JD');
  });

  it('renders Dialog components and subcomponents directly', () => {
    const dialog = renderToStaticMarkup(
      <Dialog open={true}>
        <DialogTrigger>Open</DialogTrigger>
        <DialogOverlay className="custom-overlay" />
        <DialogContent closeAriaLabel="Close dialog">
          <DialogHeader>
            <DialogTitle>Dialog Title</DialogTitle>
            <DialogDescription>Dialog Desc</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button>OK</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(dialog).toContain('Open');
    expect(dialog).toContain('Dialog Title');
    expect(dialog).toContain('Dialog Desc');
    expect(dialog).toContain('Close dialog');
  });

  it('renders Sheet components with side variants and subcomponents directly', () => {
    const sheet = renderToStaticMarkup(
      <Sheet open={true}>
        <SheetTrigger>Open Sheet</SheetTrigger>
        <SheetOverlay className="sheet-overlay" />
        <SheetContent side="left" closeAriaLabel="Close sheet">
          <SheetHeader>
            <SheetTitle>Sheet Title</SheetTitle>
            <SheetDescription>Sheet Desc</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <button>Save</button>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    expect(sheet).toContain('Open Sheet');
    expect(sheet).toContain('Sheet Title');
    expect(sheet).toContain('Close sheet');

    for (const side of ['top', 'bottom', 'right'] as const) {
      const s = renderToStaticMarkup(
        <Sheet open={true}>
          <SheetContent side={side}>{side}</SheetContent>
        </Sheet>,
      );
      expect(s).toContain(side);
    }
  });

  it('renders DropdownMenu components and subcomponents directly', () => {
    const menu = renderToStaticMarkup(
      <DropdownMenu open={true}>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent sideOffset={8}>
          <DropdownMenuGroup>
            <DropdownMenuLabel inset>Group</DropdownMenuLabel>
            <DropdownMenuItem inset>Item 1</DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={true}>Checked</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={false}>Unchecked</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="a">
              <DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Submenu</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub Item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuShortcut>Ctrl+K</DropdownMenuShortcut>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(menu).toContain('Menu');
    expect(menu).toContain('Group');
    expect(menu).toContain('Item 1');
    expect(menu).toContain('Ctrl+K');
  });
});
