import { NextRequest, NextResponse } from 'next/server';
import { yahooFinanceServer } from '@/services/adapters/yahooFinanceServer';

export async function GET(
request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const symbol = searchParams.get('symbol');
  const range = searchParams.get('range') || '1y';
  const interval = searchParams.get('interval') || '1d';
  const includePrePost = searchParams.get('includePrePost') === '1';

  if (!symbol) {
    return NextResponse.json({ error: 'Symbol parameter is required' }, { status: 400 });
  }

  try {
    const data = await yahooFinanceServer.getHistorical(symbol, range, interval, 30_000, false, includePrePost);
    
    if (data && data.confidence > 0) {
      return NextResponse.json(data);
    }
    
    return NextResponse.json({ error: `Failed to fetch historical data for ${symbol}` }, { status: 500 });
  } catch (error: any) {
    console.error(`Error fetching historical Yahoo Finance data for ${symbol}:`, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
