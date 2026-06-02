---
title: "Æon: Sound as a Function of Time"
date: "2026-06-02"
description: "Modeling a whole audio engine as one pure function of time. A cool and rather stupid idea, taken as far as it goes before performance bites back."
summary: "I always thought a purely functional audio engine would be cool and utterly stupid. Æon is that little toy. The whole engine is one pure function of time, built from small functions you chain together into oscillators, envelopes, delays and sequencers. Recursing backwards in time gives you a delay for free, until it blows up into O(2ⁿ) and you fall back to a boring ring buffer."
tags: ["audio", "dsp", "functional", "javascript"]
math: true
scripts:
  - js/main.js
---

When I was working at [audiotool.com](https://audiotool.com) from 2008-2012ish I always thought about how cool and utterly stupid a purely functional audio engine would be. 

At that time, I was fully embracing purely functional data types and drank the Scala<ext-link href="https://www.scala-lang.org"></ext-link> Kool-Aid. I had Okasaki's _Purely Functional Data Types_<ext-link href="https://www.cs.cmu.edu/~rwh/students/okasaki.pdf"></ext-link> on my night shelf and all I could think about was immutability, persistent data structures, pure functions and what have you.

The idea is quite simple. You think about the entire audio engine as \(T \rightarrow \mathbb{R}^2\). I was obviously not alone with that idea — some time has passed since 2010, and it isn't really that innovative either. In fact, it is rather stupid, but more on that later. I think it's quite logical for Shadertoy<ext-link href="https://www.shadertoy.com"></ext-link> to adopt this too, as every image is basically just a function, and so can audio be[^1]. They do it a bit differently and GLSL has some limitations that make everything less flexible.

If everything is purely functional, and your functions are pure, you can move in time as you please and start to perform recursive calls. Meet my little toy engine [Æon](https://github.com/joa/aion)[^2].

**Live Demo:** https://joa.github.io/aion/

## Architecture & Host

The entire engine itself is about 100 LoC. It is very straightforward as we really only need to call a function over and over. There's [the host](https://github.com/joa/aion/blob/main/src/aion-host.js) itself which we can feed arbitrary JavaScript expressions. The host performs the setup of the `AudioContext` and `AudioWorkletNode`. The worklet node lets [our processor](https://github.com/joa/aion/blob/main/src/worklet/aion-processor.js) run on its own audio rendering thread and is the second piece we need. The processor is using message passing to communicate with the host. We send the JavaScript code to the processor, the processor `eval`s it and can send error messages back to the host, or let it know how much time has elapsed and so on.

As the browser asks for audio samples, we call the given function for the time `t`. And thanks to the JIT, our performance is okay. We also do some gymnastics so that the expression can call itself because we want recursion. That's achieved by passing in a reference of the evaluated function as an argument to that function. The host can start or stop the audio and also recompile the code. That allows us to modify it in real-time. In order to have batteries included I also prepend the standard library to the code before evaluating it and all of a sudden you do have something that's actually pretty capable.

The [standard library](https://github.com/joa/aion/blob/main/src/aion-std.js) ([docs](https://github.com/joa/aion/blob/main/README.md#standard-library)) provides synthesizers, sequencers and so on and weighs another 1000 LoC. It's optional and all the examples in this blog post are self-sufficient. If you press a ▶ button, we search for the preceding `<code>` block and recompile it with Æon. The standard library is absent.

## Purely Functional Audio Processing

The expression we compile is of \(T \rightarrow \mathbb{R}^2\). One of the simplest examples, the hello-world of audio programming, is a sine wave at 440 Hz.

```js
t => (a => [a, a])(Math.sin(440 * t * 2 * Math.PI))
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

Now let's say we want to change the pitch, that `440`, and have a function `sinOsc` (sine oscillator) that creates and returns a function for a specific Hertz constant. It's as simple as

```js
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }

stereo(sinOsc(220))
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

`220` is half of `440` and in the world of audio, dividing by 2 is exactly one octave down. But wait. Let's not forget about a key concept here. We created a function `sinOsc` that creates and returns a function. If we follow down that rabbit hole, our entire audio engine becomes _declarative_, meaning if we continue like this, we can freely chain functions. In fact nearly all functions of the standard library have the form `f(I) -> (t) -> O`.

For example, let's say we write a function that adjusts the volume of a signal. In Æon, a signal is always \(\mathbb{R}^2\) which we express as a simple 2d-array as you can see above.

```js
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)

vol(stereo(sinOsc(880)), 0.1)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

Let's continue with this concept and say we want to sum multiple signals because one sine is becoming boring. The idiomatic way to achieve this is by using `reduce`.

```js
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])

sum( // C major chord
  vol(stereo(sinOsc(261.63)), 0.2),
  vol(stereo(sinOsc(329.63)), 0.2),
  vol(stereo(sinOsc(392.00)), 0.2)
)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

You get the idea. We can chain functions now and start to build actual chords. The code you see here runs without the standard library and is everything we need to make sound.
However I must confess: I have been lying to you to some extent. There is a `sum` function [in the standard library](https://github.com/joa/aion/blob/main/src/aion-std.js#L124C3-L141C4) but it does not look anything like this. And that's because of performance reasons. Creating new arrays for 48000 samples per second can produce a lot of pressure for the garbage collector. I started like this but when performance was becoming more of an issue I added some hidden state to my function. Is it still pure? Yes. Can you hold on to the output during multiple invocations? No. The trick is easy to explain with the `stereo` utility. You've already seen `const stereo = f => t => { const a = f(t); return [a, a] }`. The only difference is we add `const alloc = () => new Float64Array(2)` and use it like so:

```js
const alloc = () => new Float64Array(2)
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => {
  const signal = alloc() // what is this? state?!
  return t => {
    const a = f(t)
    signal[0] = a
    signal[1] = a
    return signal
  }
}

stereo(sinOsc(220))
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

We instantiate a single `Float64Array` per closure and reuse it across invocations. There are some caveats to this but we can ignore them for the purpose of this blog post. This concept will come in handy later though.

## Envelopes

Sound is boring when it is just a perfect continuous wave. Envelopes give a sound character. A pluck like a guitar, or a long attack and release like a string. In order to apply an envelope to the amplitude of an oscillator we only need to multiply the two. That's rather simple and envelopes are again just functions of `t`.

Let's say we want to model a pluck. Something that decays over time. A simple way of doing this is \(f(t, \text{strength}, \text{length}) = e^{-\text{strength} (t \bmod \text{length})}\) which you could just plug into graphtoy.com<ext-link href="https://www.graphtoy.com/"></ext-link> and see how it works.

```js
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const env = (f, s = 5, l = 1) => t => vol(f, Math.exp(-s * (t % l)))(t)

sum( // C major chord
  env(vol(stereo(sinOsc(261.63)), 0.3)),
  env(vol(stereo(sinOsc(329.63)), 0.3)),
  env(vol(stereo(sinOsc(392.00)), 0.3))
)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

There's of course also the classic ADSR envelope in the audio world. You define attack-, decay- and release-time plus a sustain level. It basically boils down to a larger `if`-statement where you say "if `t < attackSec` then I am in the attack phase" and so on. I do want to keep it simple here so our envelope is 0s attack and then just a sharp release phase.

In this example we set the length of our notes to prime numbers and all of a sudden it already becomes more interesting.

```js
const sawOsc = hz => t => { const p = t * hz; return 2 * (p - Math.floor(p)) - 1 }
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const env = (f, s = 5, l = 1) => t => vol(f, Math.exp(-s * (t % l)))(t)
const tune = 0.25 // tune it down by 2 octaves

sum( // G#min arpeggio
  env(vol(stereo(sawOsc(415.30 * tune)), 0.2), 5, 2),
  env(vol(stereo(sawOsc(493.88 * tune)), 0.2), 5, 3),
  env(vol(stereo(sawOsc(622.25 * tune)), 0.2), 5, 5),
  env(vol(stereo(sawOsc(830.61 * tune)), 0.2), 5, 7),
)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

## Effects

I said in the beginning this is about being able to jump back in time. Let's implement it in form of a delay. Remember we do all of this still without any of the standard library and the examples are actually just sending the code you see here to the engine. Audio is really not that hard in terms of the concepts.

For a delay at time \(t\), we want to mix in the signal at time \(t - n\) for some decaying volume over \(m\) steps. Because we can just call pure functions as often as we want for any \(t\), the delay itself is just represented as a simple sum.

\[
D(t) = \sum_{n=1}^{N} \alpha^{n-1} \mathbf{f}(t - n\Delta t)
\]

In JavaScript it looks like this:

```js
const delay = (f, steps, stepSec, feedback) => t => 
  Array.from({ length: steps })
    .reduce(([l, r, gain], _, i) => {
        const tt = t - (i + 1) * stepSec
        const [vl, vr] = tt < 0 ? [0, 0] : f(tt)
        return [
          l + (vl * gain),
          r + (vr * gain),
          gain * feedback]
      }, [0, 0, 1] // init: [l, r, gain]
    ).slice(0, 2); // return only [l, r]
const sawOsc = hz => t => { const p = t * hz; return 2 * (p - Math.floor(p)) - 1 }
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const env = (f, s = 5, l = 1) => t => vol(f, Math.exp(-s * (t % l)))(t)
const mix = (f, g, v) => sum(vol(f, v), vol(g, 1 - v))

const tune = 0.5 // tune it down by 1 octave

const dry = sum( // G#min arpeggio
  env(vol(stereo(sawOsc(415.30 * tune)), 0.2), 5, 2),
  env(vol(stereo(sawOsc(493.88 * tune)), 0.2), 5, 3),
  env(vol(stereo(sawOsc(622.25 * tune)), 0.2), 5, 5),
  env(vol(stereo(sawOsc(830.61 * tune)), 0.2), 5, 7),
  env(vol(stereo(sinOsc(415.30 * tune * tune)), 0.2), 2, 11),
  env(vol(stereo(sinOsc(493.88 * tune * tune)), 0.2), 2, 13),
  env(vol(stereo(sinOsc(622.25 * tune * tune)), 0.2), 2, 17),
  env(vol(stereo(sinOsc(830.61 * tune * tune)), 0.2), 2, 19),
)

const wet = delay(dry, 5, 0.25, 0.8)

mix(dry, wet, 0.8)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

This is probably the dumbest delay implementation you have ever seen. But I would also say it is the most accessible one. Let's talk quickly about performance.

## Performance

The delay I have shown you here has a time complexity of \(O(n * T_f(t))\). Usually a delay is linear, \(O(n)\) for \(n\) steps, because each tap just reads a stored sample. Mine recomputes the entire function \(f\) from scratch for every tap. That's already wasteful. But the real disaster shows up only once \(f\) contains a delay itself.

Let's have a listen to the [simple_delay.js](https://github.com/joa/aion/blob/main/examples/simple_delay.js) example from the Æon repository. 

```js
const osc = (t, hz) => Math.sin(t * hz * 2 * Math.PI)
const pluck = (t) => Math.exp(-5 * (t % 1))

(t, depth = 0) => {
  if (t < 0 || depth > 7) return [0, 0]
  const dry = osc(t, 220) * pluck(t) * 0.2
  const [wetL,] = $(t - 0.124, depth + 1) // jumping backwards in time by 124ms
  const [,wetR] = $(t - 0.126, depth + 1) // jumping backwards in time by 126ms
  return [dry + 0.8 * wetL, dry + 0.8 * wetR]
}
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

What is the time complexity? No worries. This is not a whiteboard session. `$` is the expression itself as I mentioned earlier. If every call to `$` yields two additional calls to `$` we have created a binary tree and that means we have theoretically just exploded into \(O(2^n)\). Now. Is this cool? Conceptually yes. The delay of the delay is present and so on. But if you remove that `depth` guard things will get out of control pretty quickly. 

<details>
  <summary>
    Side-quest: Echoes of the future
  </summary>
  For the purpose of this blog post I modified the delay a bit. Everybody knows what a delay is, but instead of playing the echo, let's play echoes of the future and jump forward in time.

```js
const osc = (t, hz) => Math.sin(t * hz * 2 * Math.PI)
const pluck = (t) => Math.exp(-5 * (t % 1))

(t, depth = 0) => {
  if (t < 0 || depth > 7) return [0, 0]
  const dry = osc(t, 220) * pluck(t) * 0.2
  const [wetL,] = $(t + 0.124, depth + 1) // jumping fwd in time by 124ms
  const [,wetR] = $(t + 0.126, depth + 1) // jumping fwd in time by 126ms
  return [dry + 0.8 * wetL, dry + 0.8 * wetR]
}
```
  <input type="button" value="▶"/> <input type="button" value="⏹"/>
</details>


In fact, many techniques like delays or filtering require \(O(1)\) access for previous samples. Feedback/IIR filters and delays are inherently recurrent. How can we express this in Æon? And what about purity?

This is not just my observation. If you explore more on functional reactive programming<ext-link href="https://en.wikipedia.org/wiki/Functional_reactive_programming"></ext-link>, you'll quickly figure out that people have observed these exact problems in the past[^3].

> **Funny little aside**: I also interviewed with the V8 team around 2010, when I was deep down the purely functional rabbit hole. One of the puzzles was pretty hard and all I could think about was how to solve it using immutable programming paradigms. I failed badly at that one. When they asked what my ideas for improving V8 were, I suggested it should adopt a bytecode-like subset of JavaScript for faster client-side execution. I got actually yelled at. asm.js was not born at that time and WebAssembly was totally unheard of. Google tried really long to fight asm.js because of NaCl/Dart, I guess. So in hindsight I am not surprised they reacted that way back then. I understood only later that, as with most ideas, you need proper timing and to sell it the right way. And I'm glad we are where we are now. But yeah, it was either this little intermezzo, or me failing to solve that puzzle with purely immutable data types, that didn't get me hired :)

## Buffering

In the audio world, most buffers are ring buffers. We will simply implement a ring buffer that computes data up to \(t\) and handle discontinuities. That way we get access to previous samples "for free" but we pay the price of purity. Sort of. Our functions are still observationally pure under monotonic forward time. We haven't really explored the concept of reversing time yet, but that would break these buffers for example.

The concept works like this:

```js
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const vol = (f, val) => t => f(t).map(a => a * val)
const wrap = (i, n) => ((i % n) + n) % n // push i into [0, n)

const buf = (f, capacitySec = 1) => { // this is our ring buffer
  const cap = Math.max(2, Math.ceil(capacitySec * sampleRate))
  const buf = new Float64Array(cap * 2)
  let last = -1

  const render = frame => {
    if (frame < last || frame > last + cap) {
      last = frame - 1
      buf.fill(0)
    }

    while (last < frame) {
      last++
      const [l, r] = f(last / sampleRate)
      const index = (last % cap) * 2
      buf[index] = l
      buf[index + 1] = r
    }
  }

  const fn = t => {
    const frame = Math.round(t * sampleRate)
    const index = wrap(frame, cap) * 2
    render(frame)
    return [buf[index], buf[index+1]]
  }

  fn.at = frame => {
    if (frame < 0 || frame > last || frame <= last - cap) {
      return [0, 0]
    }
    const index = wrap(frame, cap) * 2
    return [buf[index], buf[index + 1]]
  }

  return fn
}

const delay = (f, steps, stepSec, feedback, capacitySec = 8) => {
  const stepFrames = Math.round(stepSec * sampleRate)
  const bounce = buf(f, capacitySec) // create the buffer

  return t => {
    const currentFrame = Math.round(t * sampleRate)
    bounce(t) // keep buffer up to date

    return Array.from({ length: steps }).reduce(
      ([l, r, gain], _, i) => {
        const [vl, vr] = bounce.at(currentFrame - (i + 1) * stepFrames)
        return [
          l + (vl * gain),
          r + (vr * gain),
          gain * feedback
        ];
      }, [0, 0, 1]
    ).slice(0, 2)
  }
}

const osc = (t, hz) => Math.sin(t * hz * 2 * Math.PI)
const pluck = t => Math.exp(-5 * (t % 1))

const dry = t => {
  const a = osc(t, 220) * pluck(t) * 0.2
  return [a, a]
}

const wetL = vol(delay(dry, 8, 0.124, 0.8), 0.8)
const wetR = vol(delay(dry, 8, 0.126, 0.8), 0.8)

sum(dry,
  t => { const [l, ] = wetL(t); return [l, 0] },
  t => { const [, r] = wetR(t); return [0, r] })
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

It may be a bit much. The idea is to define a new function `buf` that allows us to capture the previous results of invoking `f` for some capacity in seconds. 
We have now basically a delay that is back in the land of sane time complexities and as I mentioned earlier, many of the standard library functions make use of this hack. There is a caveat however. And that is bending time is no longer possible. I also must say that with many things in life, or when building a product: you can build something elegant and then you must come up with restrictions and workarounds to make it usable for the real world. I for once think the first version of the delay is much more beautiful and simple. But that won't help if it does not work at scale.

## Reversing Time

Let's get back to that beautiful version of the delay for a second. I am talking about reversing time, without actually ever doing that. The implementation is simple and elegant.

```js
const reverse = (f, s, e) => t => f(t >= s && t < e ? s + e - t : t)
```

The function `f` will see the time mirrored from `s` to `e`. This will cause audible click noise we have also been ignoring for the most part in this post here. But, what's also important is that we must introduce another concept and that is local time. Let's say I want to call `f` but it should only see `t` in `[0, 1s)`.

That's another one-liner.

```js
const repeat = (f, d) => t => f(t - Math.floor(t / d) * d)
```

Let's add this to one of the purely functional delay implementations from before.

```js
const reverse = (f, s, e) => t => f(t >= s && t < e ? s + e - t : t)
const repeat = (f, d) => t => f(t - Math.floor(t / d) * d)
const delay = (f, steps, stepSec, feedback) => t => 
  Array.from({ length: steps })
    .reduce(([l, r, gain], _, i) => {
        const tt = t - (i + 1) * stepSec
        const [vl, vr] = tt < 0 ? [0, 0] : f(tt)
        return [
          l + (vl * gain),
          r + (vr * gain),
          gain * feedback]
      },
      [0, 0, 1]
    ).slice(0, 2)
const sawOsc = hz => t => { const p = t * hz; return 2 * (p - Math.floor(p)) - 1 }
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const env = (f, s = 5, l = 1) => t => vol(f, Math.exp(-s * (t % l)))(t)
const mix = (f, g, v) => sum(vol(f, v), vol(g, 1 - v))

const tune = 0.5 // tune it down by 1 octave

const dry = sum( // G#min arpeggio
  env(vol(stereo(sawOsc(415.30 * tune)), 0.3), 5, 2),
  env(vol(stereo(sawOsc(493.88 * tune)), 0.3), 5, 2),
  env(vol(stereo(sawOsc(622.25 * tune)), 0.3), 5, 2),
  env(vol(stereo(sawOsc(830.61 * tune)), 0.3), 5, 2),
  env(vol(stereo(sinOsc(415.30 * tune * tune)), 0.3), 5, 3),
  env(vol(stereo(sinOsc(493.88 * tune * tune)), 0.3), 5, 3),
  env(vol(stereo(sinOsc(622.25 * tune * tune)), 0.3), 5, 3),
  env(vol(stereo(sinOsc(830.61 * tune * tune)), 0.3), 5, 3)
)

const wet = delay(dry, 5, 0.25, 0.8)

vol(repeat(reverse(mix(dry, wet, 0.8), 3.0, 6.0), 6.0), 0.5)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>

One of the most beloved devices at audiotool was and still is the [Rasselbock](https://help.audiotool.com/manuals/plugins/effects/rasselbock.html). One of my very early test versions was just a box that had a knob to tweak a random seed. Everything else, which effect to use for how long, was based on a cellular automata. Of course many similar VSTs already existed and I took a lot of inspiration from them. In the end everything was implemented via a step sequencer. The Rasselbock is a classic resampler. Let's say you draw a note that is a full bar for the reverse effect. In that case, the device would start a buffer and for the first 50% of the time, it would record samples, and then for the remaining time it would play them back in reverse. This is what got me actually thinking about a purely functional engine and how amazing that would be.

Have a listen to the cellular automata mode here featuring other effects, such as scratching, stutters and more:

<iframe width="100%" height="300" scrolling="no" frameborder="no" allow="autoplay; encrypted-media" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/soundcloud%253Atracks%253A50127&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true&visual=true"></iframe><div style="font-size: 10px; color: #cccccc;line-break: anywhere;word-break: normal;overflow: hidden;white-space: nowrap;text-overflow: ellipsis; font-family: Interstate,Lucida Grande,Lucida Sans Unicode,Lucida Sans,Garuda,Verdana,Tahoma,sans-serif;font-weight: 100;"><a href="https://soundcloud.com/joa" title="joa" target="_blank" style="color: #cccccc; text-decoration: none;">joa</a> · <a href="https://soundcloud.com/joa/rasselbock" title="rasselbock" target="_blank" style="color: #cccccc; text-decoration: none;">rasselbock</a></div>

## Sequencers & Tempo

As the last topic of this surprisingly technical blog post I want to cover sequencing. That's actually a simple topic, right. How hard could it be to implement a step sequencer. You have an array of steps and index into that array using the modulo for the step duration, like \(\frac{1}{16}\) at `120bpm`. Well, yes. But what if your tempo, your beats per minute, is actually also defined as a function of time and not a constant? In that case, things get a bit more _interesting_.

In this toy engine, tempo combinators must define two functions. `{ value(t) -> bpm, phase(t) -> beats elapsed }`. `value` is the instantaneous tempo and `phase` is how many beats have elapsed by time \(t\). Since `value` is measured in beats per minute, the beat rate is \(\text{value}(t)/60\) beats per second, and the elapsed beats are simply its integral:

\[
\text{phase}(t) = \int_{0}^{t} \frac{\text{value}(\tau)}{60}\, d\tau
\]

Each combinator carries its own analytic integral so we never have to integrate numerically. For a constant tempo it collapses to \(\text{phase}(t) = \frac{\text{bpm}\cdot t}{60}\), which is exactly the code audio engineers are probably familiar with. If you build a trivial step sequencer, half of the code is in the combinator:

```js
const constBpm = bpm => ({
  value: t => bpm,
  phase: t => (bpm * t) / 60 })
```

Given a tempo we can now implement a simple monophonic step sequencer.

```js
const seq = (voices, division, tempo) => {
  const [num, den = 1] = division.split("/").map(Number)
  const stepsPerBeat = den / (4 * num)
  return t => {
    const p = tempo.phase(t) * stepsPerBeat
    const index = Math.floor(p)
    const slot = wrap(index, voices.length)
    const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
    return voices[slot]((p - index) / stepsPerSec)
  }
}
```

What's happening here? We compute the index of the current step and then call that step with a _local time_ that always starts at 0 for that step. This is a very trivial step sequencer and it is monophonic. That is, if you say you want a \(\frac{1}{16}\)th step length, each voice can be no longer than \(\frac{1}{16}\) at the current tempo. The standard library also offers a polyphonic step sequencer but that is a bit more complicated as we have to backtrack which previous voices are active at `t`. 

```js
const wrap = (i, n) => ((i % n) + n) % n

const constBpm = bpm => ({
  value: t => bpm,
  phase: t => (bpm * t) / 60 })

const seq = (voices, division, tempo) => {
  const [num, den = 1] = division.split("/").map(Number)
  const stepsPerBeat = den / (4 * num)
  return t => {
    const p = tempo.phase(t) * stepsPerBeat
    const index = Math.floor(p)
    const slot = wrap(index, voices.length)
    const stepsPerSec = (tempo.value(t) / 60) * stepsPerBeat
    return voices[slot]((p - index) / stepsPerSec)
  }
}

const reverse = (f, s, e) => t => f(t >= s && t < e ? s + e - t : t)
const repeat = (f, d) => t => f(t - Math.floor(t / d) * d)
const delay = (f, steps, stepSec, feedback) => t => 
  Array.from({ length: steps })
    .reduce(([l, r, gain], _, i) => {
        const tt = t - (i + 1) * stepSec
        const [vl, vr] = tt < 0 ? [0, 0] : f(tt)
        return [
          l + (vl * gain),
          r + (vr * gain),
          gain * feedback]
      },
      [0, 0, 1]
    ).slice(0, 2)
const sawOsc = hz => t => { const p = t * hz; return 2 * (p - Math.floor(p)) - 1 }
const sinOsc = hz => t => Math.sin(hz * t * 2 * Math.PI)
const stereo = f => t => { const a = f(t); return [a, a] }
const vol = (f, val) => t => f(t).map(a => a * val)
const sum = (...fs) => t => fs.reduce((acc, f) => {
  const [l, r] = f(t)
  return [acc[0] + l, acc[1] + r] }, [0, 0])
const env = (f, s = 5, l = 1) => t => vol(f, Math.exp(-s * (t % l)))(t)
const mix = (f, g, v) => sum(vol(f, v), vol(g, 1 - v))

const tempo = constBpm(80)

const voice = hz => env(vol(stereo(sawOsc(hz/2)), 0.3), 5, 1)
const bass = hz => env(vol(stereo(sinOsc(hz/8)), 0.3), 3, 1)

const xs = seq([
  voice(415.30), voice(493.88),
  voice(622.25), reverse(repeat(voice(830.61), 0.15), 0, 0.25),
  voice(415.30), voice(493.88),
  voice(622.25), voice(830.61),
], "1/8", tempo)

const x = mix(xs, delay(xs, 4, 0.6, 0.2), 0.8)
const y = seq([bass(415.30), bass(622.25), bass(830.61), bass(493.88)], "1/4", tempo)

sum(x, y)
```
<input type="button" value="▶"/> <input type="button" value="⏹"/>


## Conclusion

The world's your oyster. We could go on here. Part of the fun is building these little combinators you can combine in interesting ways to produce more complex arrangements. But in the end it always boils down to a simple function \(T \rightarrow \mathbb{R}^2\).

This is also something an AI can use to easily compose music. It's actually not that bad. Check out the [jazz](https://github.com/joa/aion/blob/main/examples/jazz_sonnet4_6.js) sample where Sonnet 4.6 added a little vinyl crackle to the sound that provides actually a lot of character. You can listen to the file at https://joa.github.io/aion/. 

The time complexity and performance struggle is real though. I think you can do actually a lot if you check out the Æon examples. In the end I had to trade some of the time-shifting functionality for performance. There are pure and impure versions for most functions but it is of course not as nice as being able to freely jump around in time[^4]. The Scala version I started with years ago was actually an offline renderer that used multi threading and fork-join pools. I do think this version is a lot more fun to play with.

There are so many great projects for live music if this got you interested. Check out Strudel<ext-link href="https://strudel.cc/"></ext-link> or Tidal Cycles<ext-link href="https://tidalcycles.org/"></ext-link> for some fully featured live coding options. Then there's FAUST<ext-link href="https://faust.grame.fr"></ext-link>, a functional DSL that can compile to many languages, even WASM. 

[^1]: Shadertoy evaluates a shader in blocks to pre-compute a fixed buffer of audio data on the GPU
[^2]: Æon is, like Chronos, a time-deity; where Chronos represents linear time, Æon represents eternity
[^3]: Check the [blog posts on FRP](http://conal.net/blog/tag/functional-reactive-programming) from Conal Elliott for example.
[^4]: But then again, how useful are future values, really?