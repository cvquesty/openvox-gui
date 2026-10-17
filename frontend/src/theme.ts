/**
 * Production Mantine theme — shared by Light, Dark, and Robots!!.
 *
 * Visual contract:
 * - Inter for UI, IBM Plex Mono for code
 * - 10–12px radii, soft elevation, no harsh chrome
 * - Light = VoxPupuli blue; Dark/Robots = VoxPupuli orange
 * - Cards/buttons/inputs inherit defaults so pages stay consistent
 */
import { createTheme, MantineColorsTuple, MantineThemeOverride } from '@mantine/core';

const FONT =
  'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO =
  '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const vpblue: MantineColorsTuple = [
  '#e8f1ff',
  '#d0e4ff',
  '#a4c8ff',
  '#74a9ff',
  '#448bff',
  '#0D6EFD',
  '#0b5ed7',
  '#0a4fb4',
  '#083d8a',
  '#052c65',
];

const vporange: MantineColorsTuple = [
  '#fff6eb',
  '#ffe8cc',
  '#ffd19a',
  '#ffb562',
  '#f79a38',
  '#EC8622',
  '#d9730d',
  '#b85e0b',
  '#934a09',
  '#6e3707',
];

const shadows = {
  xs: '0 1px 2px rgba(15, 23, 42, 0.05)',
  sm: '0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.06)',
  md: '0 4px 8px rgba(15, 23, 42, 0.06), 0 16px 32px rgba(15, 23, 42, 0.08)',
  lg: '0 8px 24px rgba(15, 23, 42, 0.10), 0 24px 48px rgba(15, 23, 42, 0.08)',
  xl: '0 16px 40px rgba(15, 23, 42, 0.14)',
};

function baseTheme(primary: 'vpblue' | 'vporange'): MantineThemeOverride {
  return {
    primaryColor: primary,
    // Keyboard ring color is --ov-focus in styles/app.css (light, dark, robots).
    focusRing: 'auto',
    fontFamily: FONT,
    fontFamilyMonospace: MONO,
    defaultRadius: 'md',
    cursorType: 'pointer',
    shadows,
    headings: {
      fontFamily: FONT,
      fontWeight: '600',
      sizes: {
        h1: { fontSize: '1.625rem', lineHeight: '1.25' },
        h2: { fontSize: '1.35rem', lineHeight: '1.3' },
        h3: { fontSize: '1.125rem', lineHeight: '1.35' },
        h4: { fontSize: '1rem', lineHeight: '1.4' },
        h5: { fontSize: '0.875rem', lineHeight: '1.4' },
        h6: { fontSize: '0.8125rem', lineHeight: '1.4' },
      },
    },
    colors: {
      vpblue,
      vporange,
    },
    components: {
      Card: {
        defaultProps: {
          radius: 'lg',
          shadow: 'xs',
          withBorder: true,
          padding: 'lg',
        },
      },
      Paper: {
        defaultProps: { radius: 'lg', shadow: 'xs' },
      },
      Button: {
        defaultProps: { radius: 'md', fw: 600 },
      },
      ActionIcon: {
        defaultProps: { radius: 'md' },
      },
      Badge: {
        defaultProps: { radius: 'sm', tt: 'none' },
      },
      TextInput: {
        defaultProps: { radius: 'md' },
      },
      PasswordInput: {
        defaultProps: { radius: 'md' },
      },
      Select: {
        defaultProps: { radius: 'md' },
      },
      Textarea: {
        defaultProps: { radius: 'md' },
      },
      Modal: {
        defaultProps: { radius: 'lg', shadow: 'xl', centered: true },
      },
      Alert: {
        defaultProps: { radius: 'md' },
      },
      Tooltip: {
        defaultProps: { radius: 'md', withArrow: true, openDelay: 250 },
      },
      NavLink: {
        defaultProps: { variant: 'subtle' },
        styles: {
          root: {
            borderRadius: 10,
            fontWeight: 500,
          },
        },
      },
      Table: {
        defaultProps: {
          highlightOnHover: true,
          verticalSpacing: 'sm',
          horizontalSpacing: 'md',
        },
      },
      Tabs: {
        defaultProps: { radius: 'md' },
      },
      Notification: {
        defaultProps: { radius: 'md' },
      },
    },
  };
}

export const lightTheme = createTheme({
  ...baseTheme('vpblue'),
});

export const darkTheme = createTheme({
  ...baseTheme('vporange'),
});

export const robotsTheme = createTheme({
  ...baseTheme('vporange'),
});
