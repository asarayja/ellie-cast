# Ellie Cast – forfatterside

Siden er **bare på engelsk**. Admin-panelet har norske forklaringer, men alle tekstene du skriver der vises på engelsk på siden.

Se siden lokalt: `python3 -m http.server` i denne mappen, og gå til http://localhost:8000

## Farger

Alle fargene står øverst i `assets/style.css`, i blokken merket **FARGER**. Lyst tema først, mørkt tema under
(mørkt tema står to ganger – bytt begge).

| Navn | Brukes til |
| --- | --- |
| `--bg` / `--bg-2` | Bakgrunnen |
| `--ink` | Teksten |
| `--muted` | Dempet tekst |
| `--accent` | Knapper, lenker og detaljer |
| `--accent-2` | Andre farge i glød og overganger |
| `--on-accent` | Teksten på knappene |

## Innhold og admin

Alt innholdet ligger i `data/site.json` og redigeres i `admin/` (samme GitHub-innlogging som de andre sidene):
bøker (omslag, beskrivelse, utdrag, kjøpslenker), Om Ellie, kontakt og musikk.
Teksten om Ellie er fortsatt et eksempel og må byttes ut.

## Adresser

`#/books`, `#/book/the-fragmented-collector`, `#/music`, `#/about`, `#/contact`

## Privat

PDF-er (som manuset) skal aldri på nettsiden. `.gitignore` stopper dem hvis mappen lastes opp med git,
men ikke last dem opp for hånd på GitHub heller.
