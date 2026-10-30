import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHARS, GOALS, comboOf, comboElements, shotScore, setMap } from '../src/config.js';

const two = ['thunder', 'blaze'];
const repeated = ['thunder', 'blaze', 'thunder', 'blaze', 'thunder'];
assert.deepEqual(comboOf(repeated), comboOf(two), 'return passes cannot promote a pair');
assert.equal(comboOf(repeated).level, 2);
assert.equal(comboOf(repeated).n, 2);
assert.equal(comboOf(['thunder', 'thunder', 'thunder']).level, 1, 'same-element players remain one element');
assert.equal(comboOf([...repeated, 'frost']).level, 3, 'a new third element promotes the combo');
assert.equal(comboOf([...repeated, 'frost']).n, 3);
assert.deepEqual(comboElements(['thunder', 'invalid', 'blaze', 'thunder']), two);

setMap('pitch5');
const goal = GOALS[1].centre;
for (const x of [-20, -8, 0, 8, 20]) {
  const base = shotScore(x, 0, goal.x, goal.z, ['thunder']);
  assert.equal(shotScore(x, 0, goal.x, goal.z, repeated), base + 1, 'pair power bonus is one');
  assert.equal(shotScore(x, 0, goal.x, goal.z, ['thunder', 'thunder']), base);
  assert.equal(shotScore(x, 0, goal.x, goal.z, [...repeated, 'frost']), base + 2);
}

// Exercise the actual Athlete chain-building method across successive passes.
const source = fs.readFileSync(new URL('../src/athlete.js', import.meta.url), 'utf8');
const begin = source.indexOf('  _chainFor('), end = source.indexOf('\n  /** how fast', begin);
const chainFor = new Function('comboElements', `return { ${source.slice(begin, end)} }._chainFor;`)(comboElements);
const game = { ball: { chain: null } };
const athlete = charId => ({ game, charId, _isOpp: other => !!other.enemy });
const a = athlete('thunder'), b = athlete('blaze');
let prev = null;
for (let i = 0; i < 30; i++) {
  const current = i % 2 ? b : a;
  const els = chainFor.call(current, prev, prev !== null);
  game.ball.chain = { els, last: current }; prev = current;
  assert.ok(els.length <= 2, 'A/B return pass chain stays bounded at two');
}
const c = athlete('frost');
const third = chainFor.call(c, prev, true);
assert.equal(third.length, 3);
game.ball.chain = { els: CHARS.map(c => c.id), last: c };
assert.equal(chainFor.call(a, c, true).length, 6, 'revisiting an element preserves all six distinct elements');
const enemy = { enemy: true };
game.ball.chain.last = enemy;
assert.deepEqual(chainFor.call(a, enemy, true), ['thunder'], 'opponent breaks the chain');
console.log('PASS: 30 return passes stay at two elements; tiers, Power, third/sixth elements and possession resets.');
