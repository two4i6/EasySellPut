'use client';
import { useEffect, useState } from 'react';
import { acquireHeatmapDiscovery, type DiscoveryInput, type DiscoverySeries } from '@/lib/qqqHeatmapDiscovery';
export function useQqqHeatmapDiscovery(input: DiscoveryInput, enabled: boolean) {
  const [result, setResult] = useState<{input: DiscoveryInput; series: DiscoverySeries | null; error: boolean} | null>(null);
  useEffect(() => {
    if (!enabled) { setResult(previous=>previous?.input===input?previous:null); return; }
    let mounted = true;
    const task=acquireHeatmapDiscovery(input);
    void task.promise.then(series => { if (mounted) setResult({input, series, error: false}); }, () => { if (mounted) setResult({input, series: null, error: true}); });
    return () => { mounted = false; task.release(); };
  }, [input, enabled]);
  return {series: result?.input === input ? result.series : null, error: result?.input === input && result.error};
}
