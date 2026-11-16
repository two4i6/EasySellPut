import { Suspense } from 'react';
import { StockEngineLoading } from '@/components/LoadingScreens';
import { QqqPcsGexStandaloneContent } from './page.component';

export const metadata = { title: 'QQQ GEX · 热力图与行情观察' };

export default function QqqPcsGexPage() {
  return <div className="page-container w-full max-w-none px-0"><Suspense fallback={<StockEngineLoading symbol="QQQ" />}><QqqPcsGexStandaloneContent /></Suspense></div>;
}
