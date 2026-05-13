import '../styles/globals.css';
import type { AppProps } from 'next/app';
import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';
import Head from 'next/head';
import { AppProviders } from '../context/AppProviders';
import { AppLayout } from '../components/Layout/AppLayout';

/**
 * Pages may opt out of `AppLayout` by exporting a `getLayout` function.
 * The login + setup pages do this to render `AuthLayout` instead.
 */
export type NextPageWithLayout<P = unknown, IP = P> = NextPage<P, IP> & {
  getLayout?: (page: ReactElement) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
};

export default function App({ Component, pageProps }: AppPropsWithLayout) {
  const getLayout =
    Component.getLayout ?? ((page: ReactElement) => <AppLayout>{page}</AppLayout>);

  return (
    <AppProviders>
      <Head>
        <title>Overhearr</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </Head>
      {getLayout(<Component {...pageProps} />)}
    </AppProviders>
  );
}
