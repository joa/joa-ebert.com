<div class="bp" id="fig-qdot-mapping" data-bp-figure="qdot-mapping">
  <div class="bp-head">
    <span class="bp-tag">Decode · matrix × vector · schematic</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-qdot-mapping-title fig-qdot-mapping-desc">
    <title id="fig-qdot-mapping-title">Two ways to map a matrix-vector product onto threads</title>
    <desc id="fig-qdot-mapping-desc">With one thread per output, each thread walks its own row of weights and stops at every block of 32. With one warp per output, the 32 lanes read 512 contiguous bytes at a time, each pair of lanes shares one block, every lane multiplies its partial sum by that block's scale in a register without stopping, and a shuffle adds up the scaled partial sums.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <button type="button" class="bp-btn" data-group="mapping" data-value="thread" aria-pressed="true">Thread per output</button>
    <button type="button" class="bp-btn" data-group="mapping" data-value="warp" aria-pressed="false">Warp per output · <code>qdot_t</code></button>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>