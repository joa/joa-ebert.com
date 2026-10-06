<div class="bp" id="fig-hadamard-rotation" data-bp-figure="hadamard-rotation">
  <div class="bp-head">
    <span class="bp-tag">Rotate, then round · a 16-wide toy</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-hadamard-rotation-title fig-hadamard-rotation-desc">
    <title id="fig-hadamard-rotation-title">Rotating before rounding</title>
    <desc id="fig-hadamard-rotation-desc">A row of 16 weights with one large outlier is rounded to ternary values, once as it is and once after a Hadamard rotation. Rounded as it is, the best scale fits the outlier and the 15 small weights all round to zero. The rotation, random sign flips followed by four stages of additions and subtractions, spreads the outlier over all 16 values, and the rounding error drops from 52 to 35 percent. The model's real blocks are 1,024 wide.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <div class="bp-group" role="group" aria-label="Rotation">
      <button type="button" class="bp-btn" data-group="rotation" data-value="off" aria-pressed="false">Round as is</button>
      <button type="button" class="bp-btn" data-group="rotation" data-value="on" aria-pressed="true">Rotate, then round</button>
    </div>
    <button type="button" class="bp-btn" data-action="replay">Replay</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>