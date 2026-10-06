<div class="bp" id="fig-vram-residency" data-bp-figure="vram-residency">
  <div class="bp-head">
    <span class="bp-tag">RTX 2080 SUPER · 8 GiB</span>
    <span class="bp-readout" aria-live="polite"></span>
  </div>
  <span class="bp-aside">nvidia-smi: memory used · GPU 100% busy</span>
  <svg class="bp-svg" role="img" aria-labelledby="fig-vram-residency-title fig-vram-residency-desc">
    <title id="fig-vram-residency-title">What fits on an 8 GiB card</title>
    <desc id="fig-vram-residency-desc">The desktop, the runtime's buffers and the model's weights share 8 GiB of VRAM. When they don't fit, whole allocations move to system RAM and are paged back over PCIe whenever a kernel reads them.</desc>
  </svg>
  <div class="bp-controls" role="group" aria-label="Figure controls">
    <label class="bp-range-label">Desktop VRAM <input type="range" class="bp-range" data-param="desktopMiB" min="800" max="2200" step="10" value="1000"></label>
  </div>
  <noscript><p class="bp-noscript">This figure is interactive and needs JavaScript.</p></noscript>
</div>