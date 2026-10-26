/*
 * Monte Carlo runner. Spreads headless sims across Web Workers built from a
 * Blob of the engine source, so it works from file:// with no server.
 * Falls back to time-sliced runs on the main thread if workers are unavailable.
 */
const Trials = (() => {
  let workers = null;
  let workerUrl = null;
  let broken = false;

  function poolSize() {
    return Math.max(1, Math.min(12, (navigator.hardwareConcurrency || 4) - 1));
  }

  function makePool() {
    if (workers || broken) return workers;
    try {
      const src = `const Sim = (${SimCore.toString()})();
onmessage = (e) => {
  const { id, cfg, picks, seed } = e.data;
  postMessage({ id, result: Sim.runHeadless(cfg, picks, seed) });
};`;
      workerUrl = workerUrl || URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      workers = [];
      for (let i = 0; i < poolSize(); i++) workers.push(new Worker(workerUrl));
    } catch (err) {
      console.warn('Workers unavailable, running trials on the main thread.', err);
      broken = true;
      workers = null;
    }
    return workers;
  }

  function killPool() {
    if (workers) workers.forEach(w => w.terminate());
    workers = null;
  }

  /**
   * Run jobs ([{ picks, seed }]) with one config.
   * onResult(result, doneCount, total) fires per finished trial; onDone(results) at the end.
   * Returns { cancel }.
   */
  function run(cfg, jobs, onResult, onDone) {
    const total = jobs.length;
    const results = new Array(total);
    let finished = 0;
    let cancelled = false;

    const deliver = (i, r) => {
      if (cancelled) return;
      results[i] = r;
      finished++;
      onResult && onResult(r, finished, total);
      if (finished === total) onDone && onDone(results);
    };

    const pool = makePool();
    if (!pool) return runMainThread();

    let next = 0;
    let failed = false;
    const inFlight = new Map();
    const pump = (w) => {
      if (cancelled || failed || next >= total) return;
      const id = next++;
      inFlight.set(w, id);
      w.postMessage({ id, cfg, picks: jobs[id].picks, seed: jobs[id].seed });
    };
    pool.forEach(w => {
      w.onmessage = (e) => {
        inFlight.delete(w);
        deliver(e.data.id, e.data.result);
        pump(w);
      };
      w.onerror = (e) => {
        // e.g. a browser that blocks blob workers on file://
        if (failed) return;
        failed = true;
        e.preventDefault && e.preventDefault();
        console.warn('Worker failed, falling back to the main thread.', e.message);
        broken = true;
        killPool();
        const remaining = [];
        for (let i = 0; i < total; i++) if (results[i] === undefined) remaining.push(i);
        runMainThread(remaining);
      };
      pump(w);
    });

    return { cancel() { cancelled = true; killPool(); } };

    function runMainThread(indices) {
      const queue = indices || jobs.map((_, i) => i);
      let k = 0;
      const tick = () => {
        if (cancelled) return;
        const end = performance.now() + 25;
        while (k < queue.length && performance.now() < end) {
          const i = queue[k++];
          deliver(i, Sim.runHeadless(cfg, jobs[i].picks, jobs[i].seed));
        }
        if (k < queue.length) setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
      return { cancel() { cancelled = true; } };
    }
  }

  // Wilson score interval for a proportion, as [lo, hi].
  function wilson(k, n, z = 1.96) {
    if (!n) return [0, 0];
    const p = k / n, d = 1 + (z * z) / n;
    const c = p + (z * z) / (2 * n);
    const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
  }

  function randomSeed() {
    return (Math.random() * 0xffffffff) >>> 0;
  }

  return { run, wilson, randomSeed };
})();
