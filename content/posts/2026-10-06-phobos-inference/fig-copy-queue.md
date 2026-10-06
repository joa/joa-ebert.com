<div class="bp" id="fig-copy-queue" data-bp-figure="copy-queue">
  <div class="bp-head">
    <span class="bp-tag">One layer of a decode step · schematic</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-copy-queue-title fig-copy-queue-desc">
    <title id="fig-copy-queue-title">An 8 KB readback stuck behind the expert copies</title>
    <desc id="fig-copy-queue-desc">Before: the activation row the CPU needs waits in the copy engine's queue behind large expert refills, so first the CPU and then the GPU wait. After: the GPU writes the row into pinned host memory, the CPU starts immediately, and the GPU picks up the result by polling a flag.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <button type="button" class="bp-btn" data-group="path" data-value="before" aria-pressed="true">Before</button>
    <button type="button" class="bp-btn" data-group="path" data-value="after" aria-pressed="false">After</button>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>