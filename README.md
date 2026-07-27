### joa-ebert.com

Personal website and playground.

Static site built with [Hugo](https://gohugo.io) and [Vite](https://vite.dev), styled with
[Tailwind](https://tailwindcss.com). The header is a real-time [WebGPU](https://www.w3.org/TR/webgpu/)
scene — instanced grass, weather, a day/night cycle — with a static image fallback where WebGPU is
unavailable. No runtime dependencies, except [KaTeX](https://katex.org) on posts that ask for math.

### Development

```bash
npm run dev     # Vite + Hugo, hot reload on :1313
npm run build   # → dist/
npm start       # preview the build
npm run lint    # Prettier check
```

### Layout

```
content/posts/  blog posts, Markdown
layouts/        Hugo templates
js/webgpu/      renderer, shaders, GPU resources
js/shared/      camera, time, wind, atmosphere, boids
css/            Tailwind entry point
scripts/        image conversion, font subsetting, screenshots
```
