# Protocol Schema v1.1 (frozen)

One condition = one JSON file = 1 to 5 phone screens. Layout from PACK (red box, top-to-bottom, Assess / Treat / Advise / Refer), Algerian drug data from the national nomenclature.

## Screen order

1. **Red box**: when to call the SAMU / send to urgences, and what to do meanwhile
2. **Évaluer**: signs and symptoms (how the patient presents), ask, examine, diagnostic confirmation, tests, decision pathway
3. **Traiter**: drugs (dose inline, officine/hôpital tag, Algerian brands), other actions, do-not list
4. **Conseiller**: what to tell the patient
5. **Orienter et suivre**: referral (3 levels) + "when / what" follow-up table
6. Sources and review (footer)

## JSON

```json
{
  "schema_version": "1.1.0",

  "meta": {
    "id": "embolie-pulmonaire",
    "title": "Embolie pulmonaire aiguë",
    "template": "urgence",
    "audience": ["MG"],
    "country": "DZ",
    "language": "fr",
    "motifs": ["dyspnée aiguë", "douleur thoracique"],
    "specialite": "pneumologie",
    "version": "1.0.0",
    "status": "draft",
    "last_reviewed_at": null,
    "next_review_at": null
  },

  "scope": {
    "population": "Adultes",
    "exclusions": []
  },

  "red_box": {
    "signs": [],
    "actions": []
  },

  "assess": {
    "symptoms": [],
    "ask": [],
    "examine": [],
    "diagnosis": [],
    "tests": [],
    "pathway": {
      "start_node_id": null,
      "nodes": []
    }
  },

  "treat": {
    "medications": [],
    "actions": [],
    "do_not": []
  },

  "advise": [],

  "refer_follow": {
    "refer": [],
    "follow_up": []
  },

  "sources": [],

  "review": {
    "reviewer": null,
    "reviewed_at": null,
    "clinical_approval": false,
    "unresolved_issues": [],
    "change_log": []
  }
}
```

## Building blocks

**Item**: every clinical line (signs, symptoms, ask, examine, diagnosis, tests, actions, do_not, advise) uses this shape.

```json
{
  "id": "ep-001",
  "text": "Dosez les D-dimères ajustés à l'âge (âge × 10 µg/L).",
  "condition": "probabilité clinique < 50 %",
  "timing": null,
  "strength": "modérée",
  "origin": "source",
  "basis": null,
  "evidence": [
    { "source_id": "aha-acc-2026", "page": 1633, "quote": "an age-adjusted D-dimer value below the threshold..." }
  ],
  "refs": []
}
```

- `timing`: `immediate` | `same_day` | `prompt` | `routine` | null
- `strength`: `forte` | `modérée` | `faible` | `à_éviter` | null
- `origin`: `source` | `adaptation_locale` (if `adaptation_locale`: `basis` is required, `evidence` may be empty, reviewer must sign)
- `refs`: IDs of scores or other fiches (e.g. `S-wells`), labels resolved at display

**Medication**

```json
{
  "id": "med-apixaban-init",
  "inn": "apixaban",
  "phase": "initiation",
  "dose": 10,
  "dose_unit": "mg",
  "dose_basis": "fixe",
  "route": "orale",
  "frequency": "2 fois par jour",
  "duration": "7 jours",
  "max_dose": null,
  "condition": null,
  "adjustments": [],
  "contraindications": [],
  "alternative_group": "aod-initiation",
  "prescriber": "officine",
  "local_availability": {
    "country": "DZ",
    "status": "enregistre",
    "brands": ["APIXABEK", "APIXAR", "BIOPEXA", "INIBIX", "XIBAN"]
  },
  "strength": "forte",
  "evidence": [],
  "missing": []
}
```

- `phase`: `initiation` | `entretien` | `prolongee` | `unique`
- `dose_basis`: `fixe` | `par_kg`
- `prescriber`: `officine` | `hopital` (from nomenclature OFF / HOP)
- `local_availability.status`: `enregistre` | `non_renouvele` | `retire` | `aucune_presentation`
- `alternative_group`: same value = interchangeable options, shown as "ou"
- `missing`: fields the sources don't give, shown as "[à compléter]", never invented

**Pathway node**

```json
{
  "id": "n1",
  "type": "decision",
  "question": "Probabilité clinique ?",
  "branches": [
    { "id": "b1", "label": "< 15 %", "next_node_id": "n2" },
    { "id": "b2", "label": "< 50 %", "next_node_id": "n3" },
    { "id": "b3", "label": "> 50 %", "next_node_id": "n4" }
  ],
  "items": []
}
```

- `type`: `decision` | `action` | `end`

**Referral**

```json
{ "id": "ref-1", "criteria": "Catégorie C, D ou E", "urgency": "urgent", "destination": "hospitalisation", "strength": null, "evidence": [] }
```

- `urgency`: `urgent` | `same_week` | `next_appointment` (displayed: "en urgence" / "dans la semaine" / "au prochain rendez-vous")

**Follow-up**

```json
{ "id": "fu-1", "when": "J7", "what": "Observance, saignements, éducation", "evidence": [] }
```

**Source**

```json
{
  "id": "aha-acc-2026",
  "title": "2026 AHA/ACC Guideline for the Evaluation and Management of Acute Pulmonary Embolism in Adults",
  "organisation": "AHA/ACC",
  "citation": "Creager MA et al. J Am Coll Cardiol 2026;87(13):1626-1710",
  "url": "https://doi.org/10.1016/j.jacc.2025.11.005",
  "publication_date": "2026-04-07",
  "page_offset": -1625,
  "accessed_at": "2026-10-15"
}
```

## Templates

- **urgence**: red_box filled, assess.pathway used, refer before follow-up.
- **pathologie**: red_box may be short, assess is a checklist where follow-up items carry a `when`; Assess / Advise / Treat order.

Same JSON for both. Empty means not applicable; never fill to fill.

## Writing rules (PACK)

1. Active voice, addressed to the doctor: "Dosez", "Adressez", "Prescrivez".
2. No vague lines ("faire un examen complet"): write the exact question or sign, and what to do with each answer.
3. No pathophysiology, no epidemiology. Only what the doctor does.
4. Referral always uses one of the 3 phrases: en urgence / dans la semaine / au prochain rendez-vous.
5. 1 to 5 screens per fiche. If it doesn't fit, cut.

## Sourcing rules

1. Every clinical line has at least one `evidence` entry, or is `adaptation_locale` with a `basis`.
2. Numbers (doses, thresholds, durations) must appear verbatim in the quote; checked automatically against the page.
3. Text is a short French synthesis; the quote keeps the original wording for the reviewer.
4. Conflicting sources go in `review.unresolved_issues`, never silently merged.
5. Brands only from the Algerian nomenclature. Optional: with none picked (`status` null, `brands` empty), the app lists the nomenclature's registered products of the INN (as is, or with a salt).

## Publication gate

- Every item has evidence or an approved local adaptation.
- All quote checks pass.
- No medication has a prescribing field (dose, dose_unit, dose_basis, route, frequency) in `missing`; phase, duration, max_dose, adjustments, contraindications and strength may be published as "[à compléter]".
- Every pathway branch leads somewhere; no dead ends.
- Every `refs` ID exists and is published.
- A named doctor has approved it (`review.clinical_approval = true`).
