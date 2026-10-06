<div class="bp" id="fig-expert-cache" data-bp-figure="expert-cache">
  <div class="bp-head">
    <span class="bp-tag">Qwen3.6-35B-A3B · one layer</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-expert-cache-title fig-expert-cache-desc">
    <title id="fig-expert-cache-title">An expert cache on the GPU</title>
    <desc id="fig-expert-cache-desc">For every token the router picks eight of 256 experts. Cached experts run on the GPU. Missing ones are copied over PCIe into the cache or computed by the CPU from system RAM.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <div class="bp-group" role="group" aria-label="Misses">
      <button type="button" class="bp-btn" data-group="miss" data-value="copy" aria-pressed="true">Copy over PCIe</button>
      <button type="button" class="bp-btn" data-group="miss" data-value="cpu" aria-pressed="false">Compute on CPU</button>
    </div>
    <div class="bp-group" role="group" aria-label="Playback">
      <button type="button" class="bp-btn" data-action="toggle" aria-pressed="false">Pause</button>
      <button type="button" class="bp-btn" data-action="step">Step</button>
    </div>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>