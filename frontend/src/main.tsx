/**
 * OpenVox GUI - React Application Bootstrap
 * 
 * Entry point that initializes the React application with:
 * - MantineProvider for UI components with custom Vox Pupuli theming
 * - ThemeProvider for Casual/Formal theme switching
 * - BrowserRouter for client-side routing
 * - Notifications for toast messages and alerts
 * 
 * Theme Configuration:
 * - vporange: Vox Pupuli Orange (#EC8622) primary color
 * - vpblue: Bootstrap blue (#0D6EFD) primary color
 * - Light: Clean light mode with blue accents
 * - Dark: Clean dark mode with orange accents (color scheme from Robots!!)
 * - Robots!!: Dark mode with orange accents and animated illustrations (fun theme)
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme, MantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ThemeProvider, useAppTheme } from './hooks/ThemeContext';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const lightTheme = createTheme({
  primaryColor: 'vpblue',
  colors: {
    vpblue: [
      '#e7f1ff', '#cfe2ff', '#9ec5fe', '#6ea8fe', '#3d8bfd',
      '#0D6EFD', '#0b5ed7', '#0a58ca', '#084298', '#052c65',
    ],
  },
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'sm',
});

const darkTheme = createTheme({
  primaryColor: 'vporange',
  colors: {
    vporange: [
      '#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d',
      '#EC8622', '#e67700', '#d9730d', '#c2630a', '#a35208',
    ],
  },
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'sm',
});

const robotsTheme = createTheme({
  primaryColor: 'vporange',
  colors: {
    vporange: [
      '#fff4e6', '#ffe8cc', '#ffd8a8', '#ffc078', '#ffa94d',
      '#EC8622', '#e67700', '#d9730d', '#c2630a', '#a35208',
    ],
  },
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  defaultRadius: 'md',
});

function ThemedApp() {
  const { theme: appTheme } = useAppTheme();
  let mantineTheme: any;
  let colorScheme: MantineColorScheme;

  if (appTheme === 'light') {
    mantineTheme = lightTheme;
    colorScheme = 'light';
  } else if (appTheme === 'dark') {
    mantineTheme = darkTheme;
    colorScheme = 'dark';
  } else { // robots
    mantineTheme = robotsTheme;
    colorScheme = 'dark';
  }

  return (
    <MantineProvider theme={mantineTheme} forceColorScheme={colorScheme}>
      <Notifications />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ThemedApp />
    </ThemeProvider>
  </React.StrictMode>
);
