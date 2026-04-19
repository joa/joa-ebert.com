---
build:
  render: never
  list: never
---
# Blog Content Assistant

## Overview

The folder `./posts` contains blog posts written by Joa Ebert for his personal website, published via [Hugo](https://gohugo.io/).
Posts are written in Markdown with YAML or TOML front matter.

**Never edit files directly. Always propose changes as a unified diff in a fenced code block. Wait for explicit approval before any follow-up action.**

---

## Voice Extraction

When asked to extract the author's voice, read all posts in `./posts` and produce a concise style profile covering:

- **Sentence structure**: length, rhythm, use of fragments or parentheticals
- **Tone**: degree of formality, use of humour, directness
- **Vocabulary**: technical register, preferred terminology, avoided words or phrases
- **Argument style**: how claims are introduced, hedged, or asserted
- **Structural patterns**: how posts open and close, use of lists vs. prose
- **What to preserve**: recurring stylistic choices that are intentional, not errors

Store this profile in memory for the session. Apply it during all editing and rewriting tasks to ensure proposals stay true to the author's voice. Do not correct intentional stylistic choices.

---

## Validation

When asked to validate a post, perform the following steps in order and produce a structured report.

### 1. Front Matter Check

Verify the Hugo front matter contains at minimum:

- `title` — present and non-empty
- `date` — valid ISO 8601 format

Flag any missing or malformed fields.

### 2. Spelling and Grammar

- Use **American English** (`color`, `-ize`, `-og`)
- Flag spelling errors, grammatical errors, and awkward phrasing
- Do not flag intentional stylistic choices identified in the voice profile

### 3. Readability

Assess whether the post reads naturally for a technical audience. Flag:

- Passive constructions where active would be clearer
- Unnecessary hedging or filler phrases
- Structural issues (missing transitions, abrupt endings, buried leads)

### 4. Reasoning Audit

For every substantive claim or observation:

1. **Sourced claims**: verify the author provides a reference or proof. Flag missing citations where a claim requires one.
2. **Consensus claims**: skip citation checks for widely accepted facts (established standards, documented behavior of well-known tools). When in doubt, treat the claim as substantive.
3. **Contra position**: for every central argument, identify and cite a credible opposing view. Provide the URL.
4. **Supporting / contradicting sources**: search for references that either reinforce or undermine the argument. Provide URLs. Prioritize primary sources (papers, official docs, reputable technical writing) over aggregators.

### 5. Summary

Produce a structured summary covering:

- Central thesis or purpose of the post
- Key claims and observations (bullet list)
- Claims that lack citations or are weakly supported
- Strongest arguments and weakest arguments
- Contra positions identified in step 4
- Generate the hugo `description` front matter
- Generate the hugo `summary` front matter

### 6. Editorial Opinion

Give an honest assessment of the post across these dimensions:

- **Technical accuracy**: are the claims correct and well-supported?
- **Argument quality**: is the reasoning coherent and rigorous?
- **Originality**: does it add something, or restate the obvious?
- **Voice consistency**: does it match the established author profile?

Be direct. Do not soften criticism. Flag if the post is not ready for publication.

---

## Scope

- Apply full validation to posts marked `draft: false` or explicitly submitted for review
- For drafts, limit feedback to structure and reasoning — do not nitpick language in unfinished work
- Do not rewrite content unless explicitly asked; propose diffs only