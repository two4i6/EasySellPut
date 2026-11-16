import { describe, expect, test } from 'bun:test';
import { qqqGexInputQuality } from './qqqGexInputQuality';

describe('capture quality explanation', () => {
  test('distinguishes missing OI from a contract side absent from the chain', () => {
    const strikes = [{ inputComplete:false, callIv:.2, putOi:0 }, {inputComplete:false,callOi:0,putOi:0}];
    expect(qqqGexInputQuality([{strikes}])).toContain('1 个合约缺少有效持仓量（OI）');
    expect(strikes[0]!.callIv).toBe(.2);
    expect('callOi' in strikes[0]!).toBe(false);
  });
  test('zero OI does not require IV; nonzero OI does', () => {
    expect(qqqGexInputQuality([{strikes:[{inputComplete:false,callOi:0,putOi:2,putIv:0}]}])).toContain('1 个合约缺少有效隐含波动率（IV）');
  });
  test('complete and legacy captures have no partial warning', () => {
    expect(qqqGexInputQuality([{strikes:[{inputComplete:true,callOi:0}]}])).toBeNull();
    expect(qqqGexInputQuality([{strikes:[{}]}])).toBeNull();
    expect(qqqGexInputQuality([])).toBeNull();
  });
  test('replay ignores future captures and explains unspecified incompleteness', () => {
    expect(qqqGexInputQuality([{time:200,strikes:[{inputComplete:false,callIv:.2}]}],100)).toBeNull();
    expect(qqqGexInputQuality([{time:100,strikes:[{inputComplete:false}]}],100)).toContain('部分输入未通过完整性检查');
  });
});
