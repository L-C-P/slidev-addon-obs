---
addons:
  - ./
obs:
  host: localhost
  version: 5
obsScene: Intro
---

# slidev-addon-obs

Switches OBS to the scene "Intro"

<!-- obsScene of the headmatter applies to the first slide -->

---
obsScene: Slides
---

# Slides

OBS switches to "Slides"

---

# Without obsScene

Keeps "Slides"

---
obsScene: Q&A
obsSceneDelay: 2s
---

# Q&A

OBS switches to "Q&A" after 2 seconds (immediately when navigating back)
