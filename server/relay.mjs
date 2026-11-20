const relayPacketLifetime = 4000;
const relayMinInterval = 100;
const relayReadLimit = 20;
export const relayBatchLimit = 4;
const relayBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export const relayActions = ['relay-key', 'relay-enable'];

export async function validRelayPublicKey(publicKey) {
  if (typeof publicKey !== 'string' || publicKey.length !== 88 || !relayBase64.test(publicKey)) return false;
  try {
    const data = Uint8Array.from(atob(publicKey), character => character.charCodeAt(0));
    if (data.length !== 65 || data[0] !== 4) return false;
    await crypto.subtle.importKey('raw', data, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    return true;
  } catch {
    return false;
  }
}

export function validRelayPacket(packet) {
  return typeof packet === 'string' && packet.length >= 40 && packet.length <= 8192 && relayBase64.test(packet);
}

export function relayRoomAction(room, input, seat) {
  const voice = room.voice;
  if (!input.account || room.players.length !== 2 || voice?.status !== 'approved' || voice.id !== input.voiceId) {
    return { value: { error: '语音需双方同意后才能使用。' }, status: 403 };
  }
  const relay = voice.relay ??= { enabled: false, keys: [null, null] };
  if (input.action === 'relay-enable') {
    relay.enabled = true;
  } else {
    if (relay.keys[seat] && relay.keys[seat] !== input.publicKey) {
      return { value: { error: '语音密钥已变更，请重新开启语音。' }, status: 409 };
    }
    relay.keys[seat] = input.publicKey;
  }
}

export function memoryRelay(getState, memberLifetime) {
  let sequence = 0;
  let packets = [];
  const prune = now => {
    const { rooms } = getState();
    packets = packets.filter(packet => packet.createdAt > now - relayPacketLifetime && (packet.watch || rooms[packet.code]?.voice?.id === packet.voiceId));
  };
  return {
    prune,
    exchange(input, now) {
      prune(now);
      if (input.watchRequest) {
        const { watchSeat: seat, watchRequest, id, account } = input;
        const room = Object.values(getState().rooms).find(candidate => candidate.watch?.viewers.some(viewer => viewer.request === watchRequest));
        const viewer = room?.watch.viewers.find(member => member.request === watchRequest);
        if (!room || room.closedAt || room.players.length !== 2 || room.voice?.status !== 'approved' || !viewer?.publicAudio || viewer.admin ||
          now - viewer.seen >= memberLifetime || !viewer.relayKeys?.[seat] || !viewer.relayKeys?.[seat + 2] ||
          !room.players.every(player => now - player.seen < memberLifetime && room.watch.openBy.includes(player.id) && room.watch.audioBy?.includes(player.id))) return null;
        const speaker = room.players[seat];
        const voiceId = watchRequest + '/' + seat;
        if (input.action === 'push') {
          if (speaker.id !== id || speaker.account !== account || !speaker.mic) return null;
          if (packets.some(packet => packet.voiceId === voiceId && packet.createdAt > now - relayMinInterval)) return false;
          for (const packet of input.packets ?? [input.packet]) packets.push({ seq: ++sequence, voiceId, seat, packet, createdAt: now, watch: true });
          return { seq: sequence };
        }
        if (viewer.id !== id || viewer.account !== account) return null;
        const since = room.voice.relayMicSince?.[seat] ?? 0;
        const incoming = speaker.mic ? packets.filter(packet => packet.voiceId === voiceId && packet.seq > input.after && packet.createdAt >= since).slice(-relayReadLimit) : [];
        return { packets: incoming.map(({ seq, packet }) => ({ seq, packet })) };
      }
      const room = getState().rooms[input.code];
      const voice = room?.voice;
      const seat = room?.players.findIndex(player => player.id === input.id && player.account === input.account) ?? -1;
      if (!room || room.closedAt || room.players.length !== 2 || room.players.some(player => player.seen <= now - memberLifetime) ||
        seat < 0 || voice?.id !== input.voiceId || voice.status !== 'approved' || !voice.relay?.enabled || !voice.relay.keys.every(Boolean)) return null;
      if (input.action === 'push') {
        if (!room.players[seat].mic) return null;
        if (packets.some(packet => packet.voiceId === voice.id && packet.seat === seat && packet.createdAt > now - relayMinInterval)) return false;
        for (const packet of input.packets ?? [input.packet]) packets.push({ seq: ++sequence, code: input.code, voiceId: voice.id, seat, packet, createdAt: now });
        return { seq: sequence };
      }
      const micSince = voice.relayMicSince?.[1 - seat] ?? 0;
      const incoming = room.players[1 - seat].mic ? packets.filter(packet => packet.voiceId === voice.id && packet.seat !== seat &&
        packet.seq > input.after && packet.createdAt >= micSince).slice(-relayReadLimit) : [];
      return { packets: incoming.map(({ seq, packet }) => ({ seq, packet })) };
    }
  };
}

// Authorization shares the packet statement's snapshot of the lobby. A voice-close or
// seat-change that commits first invalidates the old session before any later exchange.
const relayAuthorized = `WITH located AS (
    SELECT json_extract(payload, ?1) AS room FROM lobby_state WHERE id = 1
  ), allowed AS (
    SELECT CAST(member.key AS INTEGER) AS seat, located.room
    FROM located, json_each(located.room, '$.players') AS member
    WHERE json_extract(located.room, '$.closedAt') IS NULL
      AND json_array_length(located.room, '$.players') = 2
      AND json_extract(located.room, '$.voice.id') = ?2
      AND json_extract(located.room, '$.voice.status') = 'approved'
      AND json_extract(located.room, '$.voice.relay.enabled') = 1
      AND json_type(located.room, '$.voice.relay.keys[0]') = 'text'
      AND json_type(located.room, '$.voice.relay.keys[1]') = 'text'
      AND json_extract(member.value, '$.id') = ?3
      AND json_extract(member.value, '$.account') = ?4
      AND json_extract(located.room, '$.players[0].seen') > ?5
      AND json_extract(located.room, '$.players[1].seen') > ?5
  )`;
const relayMicOn = "json_extract(room, '$.players[' || seat || '].mic') = 1";
const relayPush = `${relayAuthorized}
  INSERT INTO voice_relay_packets (voice_id, seat, packet, created_at)
  SELECT ?2, seat, frames.value, ?7 FROM allowed, json_each(?6) AS frames
  WHERE ${relayMicOn} AND NOT EXISTS (
    SELECT 1 FROM voice_relay_packets
    WHERE voice_id = ?2 AND seat = allowed.seat AND created_at > ?8
  )
  ORDER BY CAST(frames.key AS INTEGER) RETURNING seq`;
const relayPull = `${relayAuthorized}
  SELECT packet.seq, packet.packet FROM allowed
  LEFT JOIN voice_relay_packets AS packet ON packet.seq IN (
    SELECT seq FROM voice_relay_packets
    WHERE voice_id = ?2 AND seat = 1 - allowed.seat AND seq > ?6 AND created_at > ?7
      AND created_at >= COALESCE(json_extract(allowed.room, '$.voice.relayMicSince[' || (1 - allowed.seat) || ']'), 0)
      AND json_extract(allowed.room, '$.players[' || (1 - allowed.seat) || '].mic') = 1
    ORDER BY seq DESC LIMIT ${relayReadLimit}
  )
  ORDER BY packet.seq`;

const watchRelayAuthorized = `WITH allowed AS (
  SELECT CAST(?2 AS INTEGER) AS seat, r.value AS room FROM lobby_state,
    json_each(payload, '$.rooms') AS r, json_each(r.value, '$.watch.viewers') AS v
  WHERE lobby_state.id = 1 AND json_extract(r.value, '$.closedAt') IS NULL
    AND json_extract(r.value, '$.voice.status') = 'approved' AND json_array_length(r.value, '$.players') = 2
    AND json_extract(v.value, '$.request') = ?1 AND json_extract(v.value, '$.publicAudio') = 1
    AND json_extract(v.value, '$.admin') IS NOT 1
    AND json_extract(v.value, '$.seen') > ?5
    AND json_type(v.value, '$.relayKeys[' || CAST(?2 AS INTEGER) || ']') = 'text'
    AND json_type(v.value, '$.relayKeys[' || (CAST(?2 AS INTEGER) + 2) || ']') = 'text'
    AND NOT EXISTS (SELECT 1 FROM json_each(r.value, '$.players') AS p
      WHERE json_extract(p.value, '$.seen') <= ?5
        OR NOT EXISTS (SELECT 1 FROM json_each(r.value, '$.watch.openBy') AS o WHERE o.value = json_extract(p.value, '$.id'))
        OR NOT EXISTS (SELECT 1 FROM json_each(r.value, '$.watch.audioBy') AS a WHERE a.value = json_extract(p.value, '$.id')))
    AND CASE WHEN ?6 = 1 THEN
      json_extract(r.value, '$.players[' || CAST(?2 AS INTEGER) || '].id') = ?3
        AND json_extract(r.value, '$.players[' || CAST(?2 AS INTEGER) || '].account') = ?4
      ELSE json_extract(v.value, '$.id') = ?3 AND json_extract(v.value, '$.account') = ?4 END
)`;
const watchRelayPush = `${watchRelayAuthorized}
  INSERT INTO voice_relay_packets (voice_id, seat, packet, created_at)
  SELECT ?7, seat, frames.value, ?9 FROM allowed, json_each(?8) AS frames WHERE ${relayMicOn} AND NOT EXISTS (
    SELECT 1 FROM voice_relay_packets WHERE voice_id = ?7 AND created_at > ?10)
  ORDER BY CAST(frames.key AS INTEGER) RETURNING seq`;
const watchRelayPull = `${watchRelayAuthorized}
  SELECT packet.seq, packet.packet FROM allowed
  LEFT JOIN voice_relay_packets AS packet ON packet.seq IN (
    SELECT seq FROM voice_relay_packets WHERE voice_id = ?7 AND seq > ?8 AND created_at > ?9
      AND created_at >= COALESCE(json_extract(room, '$.voice.relayMicSince[' || allowed.seat || ']'), 0)
      AND json_extract(room, '$.players[' || allowed.seat || '].mic') = 1
    ORDER BY seq DESC LIMIT ${relayReadLimit}) ORDER BY packet.seq`;

export function databaseRelay(db, memberLifetime) {
  return {
    async exchange(input, now) {
      if (input.watchRequest) {
        const pushing = input.action === 'push';
        const params = [input.watchRequest, input.watchSeat, input.id, input.account, now - memberLifetime, pushing ? 1 : 0];
        const stream = input.watchRequest + '/' + input.watchSeat;
        if (pushing) {
          const { results } = await db.prepare(watchRelayPush).bind(...params, stream, JSON.stringify(input.packets ?? [input.packet]), now, now - relayMinInterval).all();
          if (results.length) return { seq: Math.max(...results.map(row => row.seq)) };
          const allowed = await db.prepare(`${watchRelayAuthorized} SELECT 1 FROM allowed WHERE ${relayMicOn}`).bind(...params).first();
          return allowed ? false : null;
        }
        const { results } = await db.prepare(watchRelayPull).bind(...params, stream, input.after, now - relayPacketLifetime).all();
        return results.length ? { packets: results.filter(row => row.seq != null) } : null;
      }
      const params = [`$.rooms.${input.code}`, input.voiceId, input.id, input.account, now - memberLifetime];
      if (input.action === 'push') {
        const { results } = await db.prepare(relayPush).bind(...params, JSON.stringify(input.packets ?? [input.packet]), now, now - relayMinInterval).all();
        if (results.length) return { seq: Math.max(...results.map(row => row.seq)) };
        const allowed = await db.prepare(`${relayAuthorized} SELECT 1 FROM allowed WHERE ${relayMicOn}`).bind(...params).first();
        return allowed ? false : null;
      }
      const { results } = await db.prepare(relayPull).bind(...params, input.after, now - relayPacketLifetime).all();
      if (!results.length) return null;
      return { packets: results.filter(row => row.seq != null) };
    }
  };
}
