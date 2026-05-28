// Event Module
// ############
//
// Base class defining the interface all calendar event modules must implement.
// Each module is responsible for its own GPU resource lifecycle.
//
// renderAPI shape passed to init():
//   device                  GPUDevice
//   frameBindGroupLayout    group 0 layout shared by every pass
//   objectBindGroupLayout   group 3 layout (64-byte model matrix)
//   emptyBindGroupLayout    empty group for unused slots
//   gBufferFormats          ["rgba8unorm","rgba8unorm","rgba8unorm"]
//   depthFormat             "depth24plus"
//   shadowDepthFormat       "depth32float"
//
// The renderer pre-binds group 0 (frame uniforms) before invoking any hook,
// so modules only need to set group 1 and group 3.

export class EventModule {
  // eslint-disable-next-line no-unused-vars
  async init(gpu, renderAPI) {}

  // eslint-disable-next-line no-unused-vars
  update(deltaTimeS, ctx, timeInfo, windUniforms) {}

  // eslint-disable-next-line no-unused-vars
  renderShadow(pass, ctx) {}

  // eslint-disable-next-line no-unused-vars
  renderGBuffer(pass, ctx) {}

  // eslint-disable-next-line no-unused-vars
  renderForward(pass, ctx) {}

  dispose() {}
}
