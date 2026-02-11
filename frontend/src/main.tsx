import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme, MantineColorScheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ThemeProvider, useAppTheme } from './hooks/ThemeContext';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

const casualTheme = createTheme({
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

const formalTheme = createTheme({
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

function ThemedApp() {
  const { isFormal } = useAppTheme();
  const colorScheme: MantineColorScheme = isFormal ? 'light' : 'dark';
  const theme = isFormal ? formalTheme : casualTheme;

  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
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
