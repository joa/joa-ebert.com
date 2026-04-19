---
title: "The Problem with Subsets"
date: "2016-07-19"
summary: "Why 99.9% compatibility across 100 classes is not 99.9% at all."
description: "A short, uncomfortable look at compound probability: why a per-class compatibility guarantee of 99.9% collapses to near-zero for any real application — a lesson learned the hard way while building defrac."
math: true
tags: ["defrac", "compiler", "java"]
cover:
  image: "images/graph.webp"
  alt: "Plot of the function f(x) = 99.9%^x"
  relative: true
---

Let’s say you start implementing a language/VM for _n_ platforms. At some point you’ll make a decision whether or not you’ll be able to support 100% of the language’s specification or standard library.

Imagine you’re implementing Java. There will be lots of tough choices to make. Let’s assume you start emitting JavaScript code. All of a sudden you encounter sun.misc.Unsafe which allows developers to perform unsafe memory operations; or what about class loaders where bytecode instrumentation may happen at runtime? You’re faced with the decision whether or not you can keep up being fully spec compliant while still emitting JavaScript source code. Let’s say an arbitrary class has a 99.9% chance of being compatible with your implementation when accepting certain missing features. This number looks reasonable and you drop functionality like Unsafe.copyMemory — its undocumented anyways and nobody should use it, right?!

\[
  99.9\%^{100} = 90.5\%
\]

Now if you have about a 100 classes the probability of an arbitrary application running in your implementation will drop quickly to 90%. 100 classes is a ridiculously low number for any Java application since we have to count transitive dependencies and the rest of the java.{lang, util, io, …}.* behemoth as well.

The post cover shows \(f(x) = 99.9\%^x\).

You’ll obviously start to implement your java.lang.* classes so that everything works and looks nice and shiny. But inevitably your users will start linking arbitrary JAR files that bring thousands of classes to the table. In fact, your 99.9% number starts to look really bad the more classes we add. In fact we can be pretty sure that not a single application will run out of the box given this implementation. Good job!

I made this mistake myself. It’s very real.