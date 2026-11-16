/**
 * The inverse of the issuer conversion (specs/20261115-crm-offer-wizard T61; DD-59, DD-63): a v2 seed text turned back into
 * the v1 text it replaced, byte for byte. Its use is a proof: `toV1(v2)` must hash into the recorded v1 digests
 * (`v1Digests.ts`), which shows the conversion changed the issuer and nothing else. It is not a migration — T63's upgrade
 * writes the v2 text from the catalog and never converts a stored text.
 *
 * It refuses a text that is not shaped the way the conversion shaped the seeds (the two field declarations right after
 * `CLIENTE`, no other mention of the issuer fields), so an edited seed cannot pass for a converted one.
 */

const NAME = "WellD Sagl";
const ADDRESS_ROW_V1 = `| **Fornitore** | ${NAME}, Via Pessina 9, CP 1920, CH-6901 Lugano | — |`;
const ADDRESS_ROW_V2 = "| **Fornitore** | [EMITTENTE]{{?INDIRIZZO_EMITTENTE::, [INDIRIZZO_EMITTENTE]}} | — |";
const NAME_FIELD = "@@field EMITTENTE\nsource: issuer\n\n";
const ADDRESS_FIELD = "@@field INDIRIZZO_EMITTENTE\nsource: issuerAddress\n\n";
const CLIENT_FIELD = "@@field CLIENTE\nsource: client\n\n";

export function toV1(v2: string): string {
  const withAddress = v2.includes(ADDRESS_ROW_V2);
  const declarations = NAME_FIELD + (withAddress ? ADDRESS_FIELD : "");
  if (v2.split(CLIENT_FIELD + declarations).length !== 2) throw new Error("toV1: the issuer fields are not declared right after CLIENTE");
  let text = v2.replace(CLIENT_FIELD + declarations, CLIENT_FIELD);
  if (withAddress) text = text.replace(ADDRESS_ROW_V2, ADDRESS_ROW_V1);
  text = text.split("[EMITTENTE]").join(NAME);
  if (text.includes("EMITTENTE")) throw new Error("toV1: the text still mentions the issuer fields");
  return text;
}
