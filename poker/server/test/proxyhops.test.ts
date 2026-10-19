// Which entry of X-Forwarded-For is the player, and how that changes when a
// second proxy is put in front of the site.
//
// Every trusted proxy appends one entry, so the player's address sits that many
// places from the right-hand end. Get the count wrong and the address recorded
// is the proxy's: an IP ban would bar the proxy rather than the person, the
// per-address connection cap would count the whole room as one visitor, and
// the audit would file everyone as alt accounts of everyone else.
import test from 'node:test';
import assert from 'node:assert/strict';

const PLAYER = '203.0.113.9';
const CLOUDFLARE = '172.71.150.4';   // what Cloudflare connects from
const RAILWAY = '10.1.2.3';          // private: our own edge
const PUBLIC_PEER = '198.51.100.77';

async function withHops<T>(hops: string | undefined, fn: (m: typeof import('../src/sockets.ts')) => T): Promise<T> {
  const before = process.env.TRUSTED_PROXY_HOPS;
  if (hops === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = hops;
  try {
    // Fresh import each time: the hop count is read per call, not cached.
    const mod = await import('../src/sockets.ts');
    return fn(mod);
  } finally {
    if (before === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = before;
  }
}

test('one proxy: the player is the last entry', async () => {
  await withHops('1', ({ clientIp }) => {
    assert.equal(clientIp(PLAYER, RAILWAY), PLAYER);
  });
});

test('one proxy: a forged prefix is ignored', async () => {
  await withHops('1', ({ clientIp }) => {
    // The visitor typed the first entry; our edge appended the real one.
    assert.equal(clientIp(`1.2.3.4, ${PLAYER}`, RAILWAY), PLAYER);
  });
});

test('unset defaults to two hops: the custom-domain edge plus our own', async () => {
  await withHops(undefined, ({ trustedProxyHops, clientIp }) => {
    assert.equal(trustedProxyHops(), 2);
    // The edge saw the player and appended them; Railway appended the edge.
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}`, RAILWAY), PLAYER);
  });
});

test('two proxies: the player is one in from the end, not Cloudflare', async () => {
  await withHops('2', ({ clientIp }) => {
    // Cloudflare saw the player and appended them; Railway appended Cloudflare.
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}`, RAILWAY), PLAYER);
  });
});

test('two proxies: a forged prefix is still ignored', async () => {
  await withHops('2', ({ clientIp }) => {
    assert.equal(clientIp(`9.9.9.9, ${PLAYER}, ${CLOUDFLARE}`, RAILWAY), PLAYER);
  });
});

test('two proxies configured but only one present falls back to the peer', async () => {
  await withHops('2', ({ clientIp }) => {
    // Misconfiguration must never resolve to a client-supplied value.
    assert.equal(clientIp(PLAYER, RAILWAY), RAILWAY);
  });
});

test('a public peer means nothing is in front of us, so the header is ignored', async () => {
  await withHops('2', ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}`, PUBLIC_PEER), PUBLIC_PEER);
  });
});

test('no header at all is just the peer', async () => {
  await withHops(undefined, ({ clientIp }) => {
    assert.equal(clientIp(undefined, RAILWAY), RAILWAY);
    assert.equal(clientIp('', RAILWAY), RAILWAY);
  });
});

test('the hop count is clamped to something sane', async () => {
  await withHops('0', ({ trustedProxyHops }) => assert.equal(trustedProxyHops(), 1));
  await withHops('-3', ({ trustedProxyHops }) => assert.equal(trustedProxyHops(), 1));
  await withHops('99', ({ trustedProxyHops }) => assert.equal(trustedProxyHops(), 5));
  await withHops('nonsense', ({ trustedProxyHops }) => assert.equal(trustedProxyHops(), 2));
});

// ---------------------------------------------------------------------------
// The live failure: every player recorded as the proxy.
//
// Railway reaches the app from 100.64.0.0/10 — carrier-grade NAT, reserved for
// provider infrastructure and never a home connection. That range was not on
// the infrastructure list, so the proxy looked like an ordinary member of the
// public, X-Forwarded-For was thrown away as untrustworthy, and the proxy's own
// address was written into the audit. 168 players landed on seven addresses,
// which reads as a room full of alt accounts and puts a lifetime IP ban one
// click away from removing dozens of unrelated people.
test('the Railway proxy is infrastructure, not a member of the public', async () => {
  const m = await import('../src/sockets.ts');
  assert.equal(m.isInfraPeer('::ffff:100.64.0.22'), true);
  assert.equal(m.isInfraPeer('100.64.0.5'), true);
  assert.equal(m.isInfraPeer('100.127.255.255'), true);
  // The neighbouring public ranges must NOT be swept up with it.
  assert.equal(m.isInfraPeer('100.63.255.255'), false);
  assert.equal(m.isInfraPeer('100.128.0.1'), false);
});

test('a player behind the Railway proxy is recorded as themselves', async () => {
  // With one configured hop this resolves from the chain alone; with the
  // default (two: the custom-domain edge in front) a chain this short is
  // treated as suspicious and the proxy's own statement of the caller is
  // used instead — which Railway sends on every request.
  await withHops('1', ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
  });
  await withHops(undefined, ({ clientIp }) => {
    assert.equal(
      clientIp(`${PLAYER}, 100.64.0.22`, '::ffff:100.64.0.22',
        { 'x-envoy-external-address': PLAYER }),
      PLAYER,
    );
  });
});

test('however many internal layers there are, the player is found', async () => {
  // This is what actually broke. Railway's internal hops are not something we
  // are told the number of — a custom domain added one — so they are stripped
  // by recognising them rather than by counting.
  await withHops('1', ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
    assert.equal(clientIp(`${PLAYER}, 100.64.0.22, 10.1.2.3`, '::ffff:100.64.0.22'), PLAYER);
    assert.equal(clientIp(`${PLAYER}, 10.1.2.3, 100.64.0.9, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
  });
  await withHops(undefined, ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}, 100.64.0.22, 10.1.2.3`, '::ffff:100.64.0.22'), PLAYER);
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}, 10.1.2.3, 100.64.0.9, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
  });
});

test('a public-addressed proxy still has to be counted', async () => {
  // Cloudflare cannot be recognised the way an internal hop can, because a
  // public address is exactly what a player has too. TRUSTED_PROXY_HOPS is
  // still how many of those we own, and putting Cloudflare in front without
  // raising it records Cloudflare as the player.
  await withHops('2', ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
  });
  // The live failure: one hop configured while the edge sat in front.
  await withHops('1', ({ clientIp }) => {
    assert.equal(clientIp(`${PLAYER}, ${CLOUDFLARE}, 100.64.0.22`, '::ffff:100.64.0.22'), CLOUDFLARE);
  });
});

test('a visitor cannot choose the address they are recorded at', async () => {
  // A proxy appends, so anything typed by the visitor sits at the left and the
  // real address is written to the right of it. With the full edge in front
  // (the default), that means one owned public hop plus the player.
  await withHops(undefined, ({ clientIp }) => {
    assert.equal(
      clientIp(`1.2.3.4, ${PLAYER}, ${CLOUDFLARE}, 100.64.0.22`, '::ffff:100.64.0.22'),
      PLAYER,
    );
  });
  await withHops('1', ({ clientIp }) => {
    assert.equal(
      clientIp(`1.2.3.4, ${PLAYER}, 100.64.0.22`, '::ffff:100.64.0.22'),
      PLAYER,
    );
  });
});

test('with nothing in front of us the header is ignored entirely', async () => {
  const m = await import('../src/sockets.ts');
  // A public peer means no proxy, so the header is just something they typed.
  assert.equal(m.clientIp(`1.2.3.4`, PUBLIC_PEER), PUBLIC_PEER);
});

test('a proxy that states the caller in its own header is read', async () => {
  const m = await import('../src/sockets.ts');
  // No usable chain — the shape that produced the live bug.
  assert.equal(
    m.clientIp(undefined, '::ffff:100.64.0.22', { 'x-envoy-external-address': PLAYER }),
    PLAYER,
  );
  assert.equal(
    m.clientIp('100.64.0.22', '::ffff:100.64.0.22', { 'cf-connecting-ip': PLAYER }),
    PLAYER,
  );
  // But never from a peer that is not ours.
  assert.equal(
    m.clientIp(undefined, PUBLIC_PEER, { 'cf-connecting-ip': '1.2.3.4' }),
    PUBLIC_PEER,
  );
});

test('addresses are recorded in one spelling', async () => {
  const m = await import('../src/sockets.ts');
  // `::ffff:` is how Node writes IPv4 on a dual-stack listener. Left in, the
  // same person is two rows in the audit and a ban on one misses the other.
  assert.equal(m.clientIp(undefined, '::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(m.clientIp(`::ffff:${PLAYER}, ${CLOUDFLARE}, 100.64.0.22`, '::ffff:100.64.0.22'), PLAYER);
});

test('when nothing usable is offered the observed peer is kept', async () => {
  const m = await import('../src/sockets.ts');
  // Uninformative, but observed rather than claimed — so never a lie.
  assert.equal(m.clientIp('100.64.0.5, 10.1.2.3', '::ffff:100.64.0.22'), '100.64.0.22');
});
