<div class="bp" id="fig-tile-overrun" data-bp-figure="tile-overrun">
  <div class="bp-head">
    <span class="bp-tag">One tile · 32 rows</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-tile-overrun-title fig-tile-overrun-desc">
    <title id="fig-tile-overrun-title">A tile that writes past its output</title>
    <desc id="fig-tile-overrun-desc">A five-row output is covered by one 32-row tile. Without a mask, the tile writes 27 rows past the end into the next allocation, which the op-by-op check never reads.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <div class="bp-group" role="group" aria-label="Mask">
      <button type="button" class="bp-btn" data-group="mask" data-value="off" aria-pressed="true">No mask</button>
      <button type="button" class="bp-btn" data-group="mask" data-value="on" aria-pressed="false">Masked</button>
    </div>
    <div class="bp-group" role="group" aria-label="Memory">
      <button type="button" class="bp-btn" data-group="memory" data-value="fresh" aria-pressed="false">Fresh <code>cudaMalloc</code></button>
      <button type="button" class="bp-btn" data-group="memory" data-value="pool" aria-pressed="true">Buffer pool</button>
    </div>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>