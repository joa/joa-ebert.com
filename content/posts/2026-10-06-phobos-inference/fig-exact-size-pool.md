<div class="bp" id="fig-exact-size-pool" data-bp-figure="exact-size-pool">
  <div class="bp-head">
    <span class="bp-tag">Buffer pool · filed by exact size</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-exact-size-pool-title fig-exact-size-pool-desc">
    <title id="fig-exact-size-pool-title">A pool that only reuses exact sizes</title>
    <desc id="fig-exact-size-pool-desc">Requests of the same size reuse the pool's buffers. Requests of a new size every time leave their buffers behind, and memory use climbs past the card's 8 GiB.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Workload">
    <button type="button" class="bp-btn" data-group="workload" data-value="benchmark" aria-pressed="false">Benchmark</button>
    <button type="button" class="bp-btn" data-group="workload" data-value="agent" aria-pressed="true">Coding agent</button>
    <button type="button" class="bp-btn" data-group="workload" data-value="bounds" aria-pressed="false">Sized from bounds</button>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>