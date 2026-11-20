# Quickstart: Property Photos and Initials Avatars

1. Local stack running with a demo workspace (`demo:seed`).
2. Property page → "Foto de portada" → upload a JPEG; wait for processing; edit the description.
3. Property list: the card shows the photo. QR poster: the photo is above the name.
4. Guest guide home (phone, 390 px): the cover is at the top; `curl` the page and check `og:image`
   points to `/api/v1/guest/media/…/large` on the guide origin.
5. Extras → edit the surfboard → add a photo → guest Extras list and detail show it.
6. Arrival section without photos → the suggestion shows; add a photo → it goes away.
7. Team → initials avatars; sidebar account entry (1280 px); a taken-over conversation shows the
   taker's avatar.
8. Automated: unit, lint, typecheck; API integration `property-photos`; e2e `photos`; bundle check.
