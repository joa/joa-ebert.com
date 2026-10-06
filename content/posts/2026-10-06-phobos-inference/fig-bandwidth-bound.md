<div class="bp" id="fig-bandwidth-bound" data-bp-figure="bandwidth-bound">
  <div class="bp-head">
    <span class="bp-tag">Bytes vs math · RTX 2080 SUPER</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <svg class="bp-svg" role="img" aria-labelledby="fig-bandwidth-bound-title fig-bandwidth-bound-desc">
    <title id="fig-bandwidth-bound-title">Why decoding is bound by memory bandwidth</title>
    <desc id="fig-bandwidth-bound-desc">Weights stream from VRAM over the memory bus to the card's 48 SMs. Decoding reads every weight once per token and does about two operations per byte, so the bus is always busy while the math units sit mostly idle. A 512-token prompt reuses every weight 512 times, about a thousand operations per byte, so the math units are busy and the bus mostly idle. A log scale of operations per byte marks the card's balance point at about 25.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <div class="bp-group" role="group" aria-label="Phase">
      <button type="button" class="bp-btn" data-group="phase" data-value="decode" aria-pressed="true">Decode · 1 token</button>
      <button type="button" class="bp-btn" data-group="phase" data-value="prompt" aria-pressed="false">Prompt · 512 tokens</button>
    </div>
    <button type="button" class="bp-btn" data-action="toggle" aria-pressed="false">Pause</button>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>