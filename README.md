# Ellie Cast – Author Website

The official website of author Ellie Cast: https://asarayja.github.io/ellie-cast/

## Contents

| File / folder | What |
| --- | --- |
| `index.html`, `assets/` | The website |
| `data/site.json` | All content: books, excerpts, about, contact and music |
| `admin/` | Admin panel for editing the content |
| `bilder/` | Images and book covers |
| `musikk/<album-id>/` | Music uploaded through the admin panel, one folder per album |

## Admin panel

Go to https://asarayja.github.io/ellie-cast/admin/ and connect with a GitHub token
(fine-grained, with **Contents: Read and write** access to this repository). The token is only stored in your browser.

From the admin panel you can edit books (cover, description, excerpt, buy links), About Ellie, contact details and music.
Press **Publiser** to save – the site updates after about a minute.

## Colours

All colours are at the top of `assets/style.css`, in the block marked **FARGER**, based on Ellie's fursona palette
(`#7851a9`, `#609ec1`, `#242143`, `#cccccc`, `#f8edf3`).

## Pages

`#/books`, `#/book/the-fragmented-collector`, `#/music`, `#/about`, `#/contact`

## Private files

Manuscripts (PDF) and anything in `privat/` must never be published. They are excluded in `.gitignore`.
