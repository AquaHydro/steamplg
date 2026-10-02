import assert from 'node:assert';
import { classify } from './itad.js';

const e = (timestamp, amount, cut, currency = 'CNY') => ({ timestamp, deal: { price: { amount, currency }, cut } });

assert.equal(classify([e('2024-01', 50, 50), e('2025-01', 100, 0), e('2026-01', 40, 60)]).text, '新史低');
assert.equal(classify([e('2026-01', 50, 50), e('2024-01', 50, 50), e('2025-01', 100, 0)]).text, '平史低');
assert.equal(classify([e('2024-01', 30, 70), e('2026-01', 60, 40)]).text, '非史低 · 史低 30');
assert.equal(classify([e('2024-01', 30, 70), e('2026-01', 100, 0)]).text, '未打折 · 史低 30');
assert.equal(classify([e('2026-01', 100, 0)]), null);
assert.equal(classify([]), null);
// 第一次打折就是新史低
assert.equal(classify([e('2025-01', 100, 0), e('2026-01', 80, 20)]).text, '新史低');
// 旧的美元记录不参与比较
assert.equal(classify([e('2014-01', 4.99, 75, 'USD'), e('2024-01', 24, 50), e('2026-01', 24, 50)]).text, '平史低');
// 原价抓错的脏记录（cut 0）不参与比较：真实数据 413150 国区
assert.equal(classify([e('2023-03', 14.99, 0), e('2024-01', 24, 50), e('2026-01', 33.6, 30)]).text, '非史低 · 史低 24');
// 免费游戏不显示
assert.equal(classify([e('2016-06', 24, 50), e('2018-08', 0, 0)]), null);
console.log('ok');
