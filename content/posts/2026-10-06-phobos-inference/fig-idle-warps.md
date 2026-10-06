<div class="bp" id="fig-idle-warps" data-bp-figure="idle-warps">
  <div class="bp-head">
    <span class="bp-tag">One block · 8 warps × 32 threads</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-idle-warps-title fig-idle-warps-desc">
    <title id="fig-idle-warps-title">Seven idle warps</title>
    <desc id="fig-idle-warps-desc">A block of 256 threads is eight warps. Before, only one warp ran the loop over the keys. With warp_partial every warp takes one slice of the keys, and the partial results are merged at the end.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <button type="button" class="bp-btn" data-group="loop" data-value="one" aria-pressed="true">One warp</button>
    <button type="button" class="bp-btn" data-group="loop" data-value="all" aria-pressed="false"><code>warp_partial</code></button>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>