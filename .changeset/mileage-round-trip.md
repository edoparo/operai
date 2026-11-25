---
"@operai/refund-api": minor
"@operai/refund-ui": minor
---

A mileage expense can be marked as a round trip ("Andata e ritorno"). The flag is informative: the km typed are the whole trip and the amount is unchanged. It shows beside the km on the request and in review, in the request PDF ("15 km round trip × …"), in the accounting journal's Description (`Lugano-Milano - A/R - MC26/002 - …`, format 4) and in the register extract's Description (`Spese di viaggio (km) A/R`, format 3). Migration `20261125120000_mileage_round_trip` adds `refund_line.roundTrip` (false for existing lines; only a travel_km line may be a round trip).
