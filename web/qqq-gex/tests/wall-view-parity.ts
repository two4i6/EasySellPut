import assert from 'node:assert/strict';
import {wallTouchView} from 'source:qqq-wall-view';
import {summarizeWallTouches} from '../upstream/src/lib/qqqWallTouchStats';
const events:any[]=[];
for(const dte of [0,3])for(const gamma of ['positive','negative','zero'])for(const period of ['open','middle','late'])for(const side of ['put','call'])for(const horizon of [10,30])for(let i=0;i<12;i++)events.push({date:`2026-01-${String(i+2).padStart(2,'0')}`,time:i,expiry:'2026-01-20',dte,gamma,period,side,horizon,wall:600,returnedInside:i%2===0,confirmedBreak:i%3===0,favorable:i*.3,adverse:i*.2,endingMove:i-5});
let selections=0;
for(const dte of [0,3])for(const gamma of ['all','positive','negative','zero'])for(const period of ['all','open','middle','late'])for(const side of ['all','put','call'])for(const horizon of [10,30]){
 const view=wallTouchView(events,dte,horizon,gamma,period,side,true);
 const expected=events.filter(e=>e.dte===dte&&e.horizon===horizon&&(gamma==='all'||e.gamma===gamma)&&(period==='all'||e.period===period)&&(side==='all'||e.side===side));
 assert.deepEqual(view.events,expected);assert.deepEqual(view.summary,summarizeWallTouches(expected));assert.deepEqual(view.table,expected.slice(-8).reverse());
 assert.equal(view.histogram.bins.reduce((a,b)=>a+b,0),expected.length);assert.deepEqual(view.histogram.values,expected.map(e=>e.endingMove));
 const withheld=wallTouchView(events,dte,horizon,gamma,period,side,false);assert.equal(withheld.statsKnown,false);assert.equal(withheld.summary,null);assert.equal(withheld.histogram,null);assert.deepEqual(withheld.events,[]);assert.deepEqual(withheld.table,[]);selections++;
}
console.log(JSON.stringify({kind:'original-wall-UI-projection',selections,completeAndWithheld:true,untruncatedEvents:true,lastEightRows:true}));
