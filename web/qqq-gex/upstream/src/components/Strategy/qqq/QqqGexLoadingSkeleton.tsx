import { Skeleton } from '@/components/ui/skeleton';

export default function QqqGexLoadingSkeleton() {
  return <main aria-busy="true" aria-label="QQQ GEX 数据加载中" style={{ display: 'grid', gap: 6, height: '100%', minHeight: 0, width: '100%', padding: 6 }}>
    <Skeleton style={{ height: 162 }} />
    <Skeleton style={{ height: 44 }} />
    <Skeleton style={{ flex: 1, minHeight: 260 }} />
  </main>;
}
