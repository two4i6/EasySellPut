import {expect,test} from 'bun:test';
import {renderToStaticMarkup} from 'react-dom/server';
import QqqIntradayLifecycle from './QqqIntradayLifecycle';

test('missing current records use a hollow white placeholder for both strategies',()=>{
  for(const strategy of ['PCS','CS'] as const){
    const html=renderToStaticMarkup(<QqqIntradayLifecycle strategy={strategy} points={[]}
      timing="INSUFFICIENT_DATA" executionScore={null} currentContract={null}/>);
    expect(html).toContain('background:transparent;border:2px solid #fff');
    expect(html).not.toContain('background:var(--accent-danger)');
    expect(html).toContain('链未记录');expect(html).not.toContain('INSUFFICIENT_DATA');
  }
});

test('a recorded negative state keeps its filled warning color',()=>{
  const html=renderToStaticMarkup(<QqqIntradayLifecycle strategy="PCS" points={[]}
    timing="NO_ENTRY_SIGNAL" executionScore={1} currentContract={null}/>);
  expect(html).toContain('background:var(--accent-danger);border:2px solid var(--accent-danger)');
});
