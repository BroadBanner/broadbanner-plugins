# Fact-check passes: criteria, severities and traps

Read once per session before the first check. The SKILL.md steps say *what* to do; this
file says *how to judge*.

## Pass 1 — Claim extraction

- An **atomic claim** has one subject and one checkable predicate: "The Army awarded
  Anduril a $1.2B contract" is two claims (the award; the amount).
- Tag each sentence: `fact` (checkable), `attribution` ("X said Y": check that X said Y,
  not that Y is true), `analysis` (the writer's inference), `opinion`.
- In `analysis` and `opinion`, look for **smuggled facts**: "the deal, which skipped
  competition, …" asserts a fact inside an opinion. Check those.
- Headline and dek (paragraph 0) are claims. They must be supported by the body.

## Pass 2 — Support

| Verdict | Means | Typical severity |
| --- | --- | --- |
| supported | The cited ¶ says it, with the same certainty and scope | — |
| partial | Overstated, a qualifier dropped ("up to", "alleged", "about"), wrong tense ("will" vs "proposed to"), a range made a point | major (minor if meaning barely changes) |
| unsupported | The cited ¶ doesn't say it (the fact may be true elsewhere) | blocker if central, else major |
| contradicted | A source in the pack says otherwise | blocker |
| uncited | A factual claim with no citation and no link | major (blocker if central or about a named person) |

- An **opinion source** (`articleType: "opinion"`) can support only "X argues…", never a
  bare fact.
- A **live blog** may have moved on; prefer settled coverage.
- A claim cited to **one outlet** that others in the pack contradict or omit: say so.
- `quotes[].foundInUncitedSource` → the words are real but the citation is wrong (minor
  unless it misattributes the speaker).

## Pass 3 — Official record (known traps)

- **Contracts (FPDS):** ceiling / potential value ≠ obligated (committed) ≠ outlays
  (paid). "A $1.2B contract" for a ceiling is a **blocker** if the piece implies money
  spent. Check the newest modification, not the award notice.
- **Budgets:** fiscal year (Oct–Sep) vs calendar year; enacted vs requested;
  appropriation vs authorization.
- **Money over time:** nominal vs real (inflation-adjusted); say which.
- **FEC:** itemized individual contributions vs total receipts; a committee vs the
  candidate; cycle (two-year period) vs calendar year; PAC vs super PAC. Naming small
  private donors is a legal/ethics issue (pass 6).
- **BLS/Census:** seasonally adjusted vs not; preliminary vs revised; the month the
  number describes vs the month it was released.
- **Legislation:** introduced ≠ passed a chamber ≠ enacted. Committee "advanced" ≠ passed.
- **Courts:** a ruling ≠ a final judgment; a stay ≠ a reversal; "the court said" vs "a
  judge wrote in dissent".
- **Percent vs percentage points.** "Rose 5%" vs "rose 5 points".
- **Rounding:** fine if consistent and within the source's precision; not fine if it
  changes the comparison ("nearly doubled" for +60%).

## Pass 4 — Freshness

- `updatedSinceWrite: true` → re-read the cited ¶ now (`news_get_story`). If the claim
  depends on text that changed, that's a `freshness` finding (major; blocker if the
  update reverses it).
- `correctionNote` → the piece must use the corrected fact.
- Old drafts: events may have moved on (a vote happened, a person resigned). If the piece
  states a "currently" fact, check it is still current.

## Pass 5 — Opposition

Write each as a `fairness` or `context` finding with evidence:

- **Strongest counter-argument omitted**: cite a source making it. Major if the piece
  presents a contested question as settled; minor if it's a nuance.
- **No response from the criticized**: a named person/organization accused of
  wrongdoing without their response, or without "did not respond to a request for comment"
  (which itself must be sourced). Major; blocker if the accusation is serious and
  unsourced.
- **Missing context**: base rates, prior administrations doing the same, the time window
  chosen (cherry-picked start/end dates). Minor to major.
- **Intent-attributing language**: "in a bid to", "secretly", "admitted", "slammed",
  "scheme", "cover-up" without evidence of intent. Major for named people.

Opposition findings are not "both sides" quotas. A well-sourced fact does not need a
counter-quote; an argument does need its strongest rebuttal acknowledged.

## Pass 6 — Ethics and legal

- **Defamation risk:** an allegation about a named person stated as fact ("X committed
  fraud") rather than attributed ("prosecutors allege X…"). Blocker.
- **Private individuals:** naming non-public people (small donors, bystanders, minors,
  victims) without clear newsworthiness. Federal law (52 U.S.C. §30111(a)(4)) bars using
  FEC contributor names for soliciting or commercial purposes. Major; blocker for minors
  or victims.
- **Quotes:** `not_found` → blocker unless you find the quote in another source (then
  the citation is wrong: minor). `close` → major if the change alters meaning, minor if
  it's a word swap; suggest the source's exact wording.
- **Images:** an AI-generated image in the body with no disclosure line (major); a
  license/credit missing for a CC image (major); an AI image depicting real people or
  events (blocker).
- **Headline/dek:** says more than the body supports (major), or makes a claim no source
  supports (blocker).

## Source or writer?

Before adding `sourceFault` to a finding, ask: **would a careful writer, reading this
story, have got it wrong too?**

- Yes, because the story itself states the wrong figure, a quote the speaker never gave,
  or a claim the record contradicts → `sourceFault` (`inaccurate`), with the story's own
  words as evidence.
- The story carries an attributed allegation and the writer dropped the attribution →
  the writer's fault. No `sourceFault`.
- The story was right when written and events moved on → freshness, not a fault.
- An opinion column cited for a fact → the writer's fault, unless the outlet labels
  opinion as news (`biased`).

## Calibration

- If you would not bet that a finding is right, phrase it as a question in the summary
  instead of filing it.
- Prefer one well-evidenced blocker over five speculative majors.
- Previously **dismissed** findings in `article_checks list` show what this creator
  considers a false positive. Do not re-file the same kind of finding without new
  evidence.
