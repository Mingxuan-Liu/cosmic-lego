# How the roadmap sizes its stars

## What makes a topic foundational?

A large star marks an idea that helps a student understand many other topics on this map. For example, the size and period of an orbit help us weigh the stars in a binary system. Each learning link names two phenomena and explains how the first helps answer the question posed by the second. The links are editorial choices that can be reviewed individually. The ranking is calculated from those choices. [Learning links and scoring code](../packages/atlas/foundations.mjs) · [Measuring stellar masses, OpenStax Astronomy 2e](https://openstax.org/books/astronomy-2e/pages/18-2-measuring-stellar-masses)

For each topic, count every other topic reachable from it once. A topic one step away contributes one point, a topic two steps away contributes half a point, and a topic three steps away contributes a third. In general, the contribution is the reciprocal of the shortest directed path length. This is outgoing harmonic centrality. A topic at the end of a learning path can make a good destination for a lesson even when its score is zero.

The 104 phenomena are ranked among themselves. To compare the 29 domains, consider paths from a phenomenon in one domain to a phenomenon in another. Each distinct destination domain contributes once, using its shortest actual phenomenon path. Simply sharing a domain with another phenomenon does not create a learning step. The current 129 learning links give *Light & color* paths into 19 other domains, nine of them direct. *Orbital free fall* reaches 34 other phenomena, seven of them directly.

**Why this star is this size** shows the score, its rank among peers and examples of the teaching links. The roadmap's scientific references, shared diagrams and study availability are independent of the calculation. The [regression tests](../test/atlas-foundations.test.js) independently recompute the shortest paths and domain scores.

## Background reading and coverage

The scientific crosswalk maps these learner questions to the printed sections of Carroll and Ostlie’s *An Introduction to Modern Astrophysics*, second edition. A section's pages are divided equally among the phenomena mapped to it. Contributions total 1,274 pages across the full roadmap. This separate ledger records the breadth of the reference material. [Roadmap and crosswalk](../packages/atlas/roadmap.mjs) · [Cambridge contents](https://assets.cambridge.org/97811084/22161/toc/9781108422161_toc.pdf)

## Reference ledger audit

1. For two successive sections of the same chapter, subtract the earlier start page from the later start page. A section starting on page 186 followed by one starting on page 195 receives nine pages, numbered 186–194. This convention assigns a shared boundary page to the section beginning on it.
2. For the last section in a chapter, stop on the chapter’s final page. Usually this is the page before the next chapter. At a change of part, stop before the separate part divider. The four dividers on pages 1, 179, 713 and 873 are excluded. Cambridge lists the last numbered chapter as pages 1230–1278. Section 30.2 begins on page 1247, so its inclusive span is 32 pages. The separately paginated appendices, reading list, index, covers and front matter are outside the ledger. [Publisher’s section starts and part dividers](https://assets.cambridge.org/97811084/22161/toc/9781108422161_toc.pdf) · [Final chapter range](https://www.cambridge.org/highereducation/books/an-introduction-to-modern-astrophysics/140DDF8A480C3841DCCD76D66984D858/the-early-universe/52E25251BF651D98A12FF203FFA7ABF4)
3. Sum section spans to get chapter totals, then sum chapters to get part totals. Each covered page contributes once at each level. The denominator is **1,274 allocated pages**. Across the four parts the counts are 177, 533, 159 and 405, respectively.
4. Rank parts against four parts, chapters against 30 chapters, and sections against 119 sections. Rank is one plus the number of peers with a longer span. The empirical percentile is `100 × (shorter + 0.5 × tied) / peer count`, where tied includes the topic itself. Equal spans share rank and percentile. Book share and parent share use the raw page counts. Asset links and group placement never enter this calculation.

The cosmology chapter receives 86 pages, or 6.8% of the covered book, placing it first among 30 chapters at the 98.3rd percentile. Galactic motions in §24.3 receive 24 pages, with rank 4 shared among sections. These are two different comparison populations. Percentile and percentage of the book answer different questions. [Numeric dataset and analysis](../packages/atlas/coverage.mjs)

## Reading the score responsibly

A long chapter can reflect sustained mathematical development, many worked examples or extensive end matter. The contents do not identify the last line of exposition. All 30 chapter-ending sections are flagged. They collectively receive 451 pages and have a median span of 13.5 pages, compared with eight pages among the 89 other sections. The three largest section allocations are chapter tails. Among sections with another numbered section after them, §24.3 has the largest span at 24 pages.

Use this score to locate emphasis in this particular book. It cannot determine which concept is a prerequisite, the current research importance of a topic, or which visualization asset would deliver the most teaching value. A topic can recur elsewhere, and an allocated page can discuss several concepts. The reference ledger stores each numbered section at its printed location. For example, the publisher’s index places the Chandrasekhar limit on pages 569–571, Roche lobes on 658–659, and primordial nucleosynthesis on 1177–1179. Hence searches can find these terms in §§16.4, 18.1 and 29.2 respectively, without double-counting their sections. [Publisher’s subject index](https://assets.cambridge.org/97811084/22161/index/9781108422161_index.pdf)

## Reproduce the audit

The numeric observations, original labels, aliases and ranking code are in one dependency-free module. From the repository root, run the following to check every recorded start against the publisher-derived digest, verify the hierarchy partitions, and recompute tie-aware ranks and shares.

```sh
bash scripts/node.sh --test test/atlas-coverage.test.js
bash scripts/node.sh --input-type=module <<'JS'
import { coverage } from './packages/atlas/coverage.mjs';
console.log(coverage.totals);
console.table([...coverage.chapters].sort((a, b) => a.rank - b.rank)
  .map(({ number, label, pages, rank, percentile }) =>
    ({ chapter: number, topic: label, pages, rank, percentile: percentile.toFixed(1) })));
JS
```

On 2026-11-04 the publisher’s six-page contents PDF had SHA-256 `9b30a902f7c52f97735353410e96197f92b9a96147f11fe65601780ecf1324fd`. I independently extracted all pairs with Poppler’s `pdftotext -layout` and compared them to the module. The following command on that extracted text reproduces the fingerprint used in the test. It retains only section coordinates and page numbers. The PDF and its text are outside the distributed project. [Publisher’s contents PDF](https://assets.cambridge.org/97811084/22161/toc/9781108422161_toc.pdf)

```sh
pdftotext -layout contents.pdf contents.txt
python3 - <<'PY'
import hashlib, pathlib, re
text = pathlib.Path('contents.txt').read_text()
pairs = re.findall(r'^\s*(\d+\.\d+)\s+[^\n]*?\b(\d+)\s*$', text, re.M)
ledger = ''.join(f'{number}={page}\n' for number, page in pairs)
print(len(pairs), hashlib.sha256(ledger.encode()).hexdigest())
PY
```

Expected output is 119 pairs with SHA-256 `a48a10dc78b5a3be78efa0e57f88cf4d663a74854086c880f2e764c3ad76aee8`. A publisher file redesign can change the PDF fingerprint while preserving its numeric ledger.


## The two map views

Domains and phenomena both use rank within their own level. Equal scores share the same percentile and radial distance. Rescale the observed percentile range to a fraction `q` between 0 and 1. At a common viewing distance, the disk radius is proportional to `2 × 9^q`, so the largest star spans nine times the diameter of the smallest. For the center of mass, each star carries its foundation score plus one. This gives topics with zero outgoing reach some mass as well.

Pan and zoom over the plane in 2D, or orbit the cluster in 3D. Each camera keeps its own pose. A text search highlights matching stars and dims the other stars in the current field, domain and study-status filters. The table lists matching rows. All views preserve the full-map scores and positions.

## Shared visuals and study availability

A dashed line means the same diagram can help a student think through either topic. For example, an orbital path can help explain both the time a planet takes to circle its star and the moments when a transit occurs. Select the line for a question to ask about that diagram and a route into either topic. The overview limits the number of lines drawn per star. Searching and selecting can reveal additional connections.

To maintain the map, editors record specific uses of visual templates and their evidence. A domain inherits the uses documented for its phenomena. Each study that is available to students also has a working player destination. [Visual catalog](../packages/atlas/reuse.mjs) · [Topic connections and diagram prompts](../packages/atlas/roadmap-assets.mjs)
