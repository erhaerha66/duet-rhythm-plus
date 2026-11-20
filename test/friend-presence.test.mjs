import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { api, guestAccount, memoryStore } from '../server/game.mjs';
import { databaseFriends, memoryFriends } from '../server/friends.mjs';

for (const [name, makeFriends] of Object.entries({
  memory: memoryFriends,
  database: async t => {
    const sqlite = new DatabaseSync(':memory:');
    t.after(() => sqlite.close());
    for (const file of ['0001_friendships', '0013_friend_presence']) {
      sqlite.exec(await readFile(new URL(`../drizzle/${file}.sql`, import.meta.url), 'utf8'));
    }
    return databaseFriends({
      prepare(sql) {
        const statement = sqlite.prepare(sql);
        return { bind: (...params) => ({
          first: () => statement.get(...params),
          all: () => ({ results: statement.all(...params) }),
          run: () => ({ meta: statement.run(...params) })
        }) };
      }
    });
  }
})) {
  test(`${name} friend presence is opt-in, limited to accepted friends, and works in archive mode`, async t => {
    let now = 1_000_000;
    t.mock.method(Date, 'now', () => now);
    const store = memoryStore();
    const friends = await makeFriends(t);
    const guest = async (letter, nickname) => {
      const key = letter.repeat(64);
      return { key, nickname, account: await guestAccount(key), tab: crypto.randomUUID() };
    };
    const [alice, bob, carol, stranger] = await Promise.all([
      guest('a', '小满'), guest('b', '阿青'), guest('c', '小乐'), guest('d', '陌生人')
    ]);
    await friends.add(alice, bob, now);
    await friends.respond(bob.account, alice.account, 'accept');
    await friends.add(bob, carol, now);
    const request = (guest, fields = {}) => api(new Request('https://jianke.test/api/room', {
      method: 'POST', body: JSON.stringify({ id: guest.tab, guestKey: guest.key, action: 'friend-presence', adult: true, ...fields })
    }), store, {}, friends, undefined, undefined, undefined, undefined, true);
    const online = async (guest, fields) => {
      const response = await request(guest, fields);
      assert.equal(response.status, 200);
      return (await response.json()).friends;
    };
    assert.equal((await request(alice, { sharing: 'show', adult: false })).status, 403);
    assert.equal((await request(alice, { sharing: 'invalid' })).status, 400);
    assert.deepEqual(await online(alice), []);
    assert.deepEqual(await online(bob), []);
    await online(bob, { sharing: 'show' });
    assert.deepEqual(await online(alice), [{ id: bob.account, nickname: '阿青' }]);
    assert.deepEqual(await online(carol), []);
    assert.deepEqual(await online(stranger, { target: bob.account }), []);

    const secondTab = crypto.randomUUID();
    await online(bob, { id: secondTab, sharing: 'show' });
    await online(bob, { sharing: 'hide' });
    assert.deepEqual(await online(alice), [{ id: bob.account, nickname: '阿青' }]);
    now += 45_000;
    assert.deepEqual(await online(alice), []);
    await online(bob, { id: secondTab, sharing: 'show' });
    await friends.respond(alice.account, bob.account, 'remove');
    assert.deepEqual(await online(alice), []);
  });
}
