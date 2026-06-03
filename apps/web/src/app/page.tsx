'use client';

import dynamic from 'next/dynamic';

const SimulatorApp = dynamic(() => import('./simulator-app'), {
  ssr: false,
});

export default function Page() {
  return <SimulatorApp />;
}
