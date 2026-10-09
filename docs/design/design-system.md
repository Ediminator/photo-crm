# Photo CRM Design System & App Shell

This document defines the design tokens, typography, visual philosophy, theming mechanics, and accessibility standards for Photo CRM.

---

## 1. Visual Philosophy: Photography-First & Low-Chroma

Photographers and videographers use Photo CRM while viewing, evaluating, and delivering photographic works. Strong, saturated UI colors in chrome, sidebars, or headers contaminate human color perception and distract from client imagery.

**Core Principles:**

1. **Content-First Chrome:** The application chrome uses a neutral, low-chroma palette based on slate and zinc tones.
2. **Predictable Contrast:** All text and actionable icons satisfy WCAG 2.2 AA contrast ratios (minimum 4.5:1 for normal text, 3:1 for large text and UI components).
3. **No Decorative Distractions:** High-chroma saturated colors are reserved exclusively for semantic states (e.g. destructive actions in red).

---

## 2. Design Tokens (CSS Variables)

Colors are defined as HSL values inside CSS variables in `src/app/globals.css`, configured in `tailwind.config.mjs`.

### Color Tokens

| Token                      | Light Theme (HSL)          | Dark Theme (HSL)           | Description                           |
| -------------------------- | -------------------------- | -------------------------- | ------------------------------------- |
| `--background`             | `0 0% 100%` (#ffffff)      | `240 10% 3.9%` (#09090b)   | Primary canvas background             |
| `--foreground`             | `240 10% 3.9%` (#09090b)   | `0 0% 98%` (#fafafa)       | Primary body text                     |
| `--card`                   | `0 0% 100%` (#ffffff)      | `240 10% 3.9%` (#09090b)   | Card and surface container background |
| `--card-foreground`        | `240 10% 3.9%`             | `0 0% 98%`                 | Text on card surfaces                 |
| `--popover`                | `0 0% 100%`                | `240 10% 3.9%`             | Dropdown and popover background       |
| `--popover-foreground`     | `240 10% 3.9%`             | `0 0% 98%`                 | Text in popovers                      |
| `--primary`                | `240 5.9% 10%` (#18181b)   | `0 0% 98%` (#fafafa)       | Primary action background             |
| `--primary-foreground`     | `0 0% 98%` (#fafafa)       | `240 5.9% 10%` (#18181b)   | Text on primary buttons               |
| `--secondary`              | `240 4.8% 95.9%` (#f4f4f5) | `240 3.7% 15.9%` (#27272a) | Secondary surfaces and buttons        |
| `--secondary-foreground`   | `240 5.9% 10%`             | `0 0% 98%`                 | Text on secondary buttons             |
| `--muted`                  | `240 4.8% 95.9%`           | `240 3.7% 15.9%`           | Muted backgrounds and disabled states |
| `--muted-foreground`       | `240 3.8% 44%` (#6c6c76)   | `240 5% 65%` (#a1a1aa)     | Secondary text and helper labels      |
| `--accent`                 | `240 4.8% 95.9%`           | `240 3.7% 15.9%`           | Interactive hover highlight state     |
| `--accent-foreground`      | `240 5.9% 10%`             | `0 0% 98%`                 | Text on hover highlight               |
| `--destructive`            | `0 84.2% 60.2%` (#ef4444)  | `0 62.8% 30.6%` (#7f1d1d)  | Destructive action background         |
| `--destructive-foreground` | `0 0% 98%`                 | `0 0% 98%`                 | Text on destructive buttons           |
| `--border`                 | `240 5.9% 90%` (#e4e4e7)   | `240 3.7% 15.9%` (#27272a) | Border lines between sections         |
| `--input`                  | `240 5.9% 90%`             | `240 3.7% 15.9%`           | Form field borders                    |
| `--ring`                   | `240 5.9% 10%`             | `240 4.9% 83.9%`           | Focus ring outline color              |
| `--radius`                 | `0.5rem` (8px)             | `0.5rem` (8px)             | Default border radius                 |

---

## 3. Typography & Self-Hosted Fonts

- **Font Family:** Geist Sans (`--font-geist-sans`) and Geist Mono (`--font-geist-mono`).
- **Self-Hosting:** WOFF2 files are stored directly in `public/fonts/` and `src/app/fonts/` and loaded via `next/font/local`.
- **License:** SIL Open Font License 1.1 committed in `public/fonts/OFL.txt`.
- **Privacy:** 0 external requests. No Google Fonts, no Typekit, and no CDNs are ever queried at runtime.

---

## 4. Theming (Light, Dark, System) & §25 TDDDG Compliance

- Themes supported: `light`, `dark`, and `system` (matches OS preference).
- **Anti-FOUC Guarantee:** `next-themes` injects an inline script in `<head>` that applies the `.dark` class to `<html>` synchronously before DOM paint, avoiding any flash of unstyled theme.
- **TDDDG / ePrivacy Exemption:** Storing visual theme preference (`theme` in `localStorage`) and language preference (`NEXT_LOCALE` cookie with max-age <= 12 months) qualifies as **strictly necessary** under § 25(2) Nr. 2 TDDDG (formerly TTDSG) and Art. 5(3) of the ePrivacy Directive. These preferences are explicitly requested by the user and do not serve analytics, tracking, or profiling purposes.

---

## 5. Responsive App Shell Layout & Landmarks

- **Desktop (>= 1024px):**
  - Persistent `<aside>` sidebar (width 16rem / 256px) containing studio logo, navigation links (`NavLinks`), language switcher (`LocaleSwitcher`), theme toggle (`ThemeToggle`), and studio owner profile.
- **Mobile (< 1024px):**
  - Sticky `<header>` with hamburger menu button (`[data-testid="mobile-menu-trigger"]`).
  - Drawer (`Sheet`) slides in from the left on trigger activation and traps keyboard focus within the dialog.
- **Semantic Landmarks:**
  - `<header>`: Mobile application top bar.
  - `<nav aria-label="...">`: Navigation links on desktop sidebar and mobile drawer.
  - `<aside aria-label="...">`: Persistent desktop navigation landmark.
  - `<main id="main-content" tabIndex={-1}>`: Primary content landmark.
- **Skip Link:**
  - First interactive element in the DOM (`href="#main-content"`).
  - Off-screen by default (`sr-only`) and visible when focused via keyboard Tab navigation.

---

## 6. Accessibility Standards (WCAG 2.2 AA)

1. **Focus Visibility:** Every interactive button and link has visible focus outlines (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).
2. **Keyboard Trapping & Restoration:** Mobile drawer traps Tab navigation while open and restores focus to the hamburger button when closed with `Escape` or the close button.
3. **No Unlocalized Strings:** All user-visible labels, tooltips, and landmark names come from `messages/en.json` and `messages/de.json`.
4. **Touch Target Size:** Interactive controls meet minimum touch target sizes (at least 44×44px on mobile viewports).
