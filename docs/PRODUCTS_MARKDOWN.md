# Produkty w Markdown

Każdy produkt ma osobny plik `src/content/produkty/<slug>.md`. Zdjęcie okładkowe umieść w `public/content/produkty/img/`.

Przykład:

```md
---
name: "Chleb orkiszowy"
slug: "chleb-orkiszowy"
shortDescription: "Delikatny chleb orkiszowy przygotowywany z prostych składników."
productType: "physical"
sku: "CHLEB-ORK-01"
price: 1890
compareAtPrice: 2190
taxRate: 5
category: "pieczywo"
image: "/content/produkty/img/chleb-orkiszowy.png"
imageAlt: "Bochenek chleba orkiszowego na drewnianej desce"
weight: 500
initialStock: 0
featured: false
active: false
seoTitle: "Chleb orkiszowy"
seoDescription: "Delikatny chleb orkiszowy z prostym składem."
---

## Warto wiedzieć

Pełny opis produktu zapisany w Markdown.

## Przechowywanie

Informacje o przechowywaniu produktu.
```

`price` i `compareAtPrice` podawaj w groszach. `initialStock` jest używany wyłącznie podczas tworzenia nowego produktu; późniejsza synchronizacja nie nadpisuje stanu magazynowego. Pole `category` przyjmuje slug albo dokładną nazwę istniejącej kategorii Sanity.

Nowe produkty ustawiaj jako `active: false` do czasu sprawdzenia ceny, podatku, zdjęcia i opisu. Prywatnych plików produktów cyfrowych ani kluczy S3 nie zapisuj w repozytorium.
